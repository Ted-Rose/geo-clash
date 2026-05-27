# Deployment Plan

Deploys the Node.js server to **GCP Cloud Run** via **Terraform**, backed by
**Aiven Valkey**. CI/CD runs on every push to `main` via GitHub Actions.
Client is already live on Vercel.

---

## Phase 1 — AI Agent: implement all files and commit

The agent must create/modify the files below, run `npm install`, and commit
everything to `main` **before** Phase 2 begins. The CI pipeline will trigger
on that push and handle every subsequent deploy automatically.

---

### Step 1 — Create `server/Dockerfile`

Create `server/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/index.js"]
```

Cloud Run injects `PORT=8080` automatically; the server already reads it.

### Step 2 — Update `server/src/index.js` (CORS from env)

```js
const CORS_ORIGIN = process.env.CORS_ORIGIN || true; // true = reflect all (dev)

app.use(cors({ origin: CORS_ORIGIN }));
// ...
const io = new IOServer(server, {
  cors: { origin: CORS_ORIGIN, credentials: false },
});
```

### Step 3 — Create `terraform/variables.tf`

```hcl
variable "project" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Artifact Registry and Cloud Run"
  type        = string
  default     = "europe-north2"
}

variable "image_tag" {
  description = "Docker image tag to deploy (e.g. git short-SHA)"
  type        = string
}

variable "valkey_url" {
  description = "Aiven Valkey connection string (rediss://...)"
  type        = string
  sensitive   = true
}

variable "cors_origin" {
  description = "Allowed CORS origin, e.g. https://your-app.vercel.app"
  type        = string
  default     = "*"
}
```

### Step 4 — Create `terraform/main.tf`

```hcl
terraform {
  required_version = ">= 1.7"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
  backend "gcs" {
    bucket = "geo-clash-gc798-tfstate"
    prefix = "geo-clash"
  }
}

provider "google" {
  project = var.project
  region  = var.region
}

# ── Enable required APIs ───────────────────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# ── Artifact Registry ─────────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "server" {
  depends_on    = [google_project_service.apis]
  repository_id = "geo-clash"
  location      = var.region
  format        = "DOCKER"
  description   = "Geo Clash server images"

  # Keep only the 3 most recent image versions; delete everything else.
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-3-latest"
    action = "KEEP"
    condition {
      newer_version_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      tag_state = "ANY"
    }
  }
}

locals {
  image_base = "${var.region}-docker.pkg.dev/${var.project}/geo-clash/server"
  image      = "${local.image_base}:${var.image_tag}"
}

# ── Service account for Cloud Run ─────────────────────────────────────────────

resource "google_service_account" "cloud_run" {
  account_id   = "geo-clash-server"
  display_name = "Geo Clash Cloud Run SA"
}

# ── Secret Manager ────────────────────────────────────────────────────────────

resource "google_secret_manager_secret" "valkey_url" {
  depends_on = [google_project_service.apis]
  secret_id  = "geo-clash-valkey-url"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "valkey_url" {
  secret      = google_secret_manager_secret.valkey_url.id
  secret_data = var.valkey_url
}

resource "google_secret_manager_secret_iam_member" "cloud_run_read" {
  secret_id = google_secret_manager_secret.valkey_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

# ── Cloud Run service ─────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "server" {
  depends_on = [google_project_service.apis]
  name       = "geo-clash-server"
  location   = var.region
  ingress    = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = 0  # scale to zero when idle — no cost at rest
      max_instance_count = 1  # single instance; GameState lives in-process
    }

    containers {
      image = local.image

      ports {
        container_port = 8080
      }

      env {
        name  = "CORS_ORIGIN"
        value = var.cors_origin
      }

      env {
        name = "VALKEY_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.valkey_url.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
}

# Allow unauthenticated (public) access to the Cloud Run service.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.server.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
```

### Step 5 — Create `terraform/outputs.tf`

```hcl
output "artifact_registry_repo" {
  description = "Full Artifact Registry image base path"
  value       = "${var.region}-docker.pkg.dev/${var.project}/geo-clash/server"
}

output "cloud_run_url" {
  description = "Public Cloud Run service URL — use as VITE_SERVER_URL in Vercel"
  value       = google_cloud_run_v2_service.server.uri
}
```

### Step 6 — Create `terraform/terraform.tfvars.example`

```hcl
project     = "geo-clash-gc798"
region      = "europe-north2"
image_tag   = "latest"          # overridden per-deploy
valkey_url  = "rediss://default:<VALKEY_PASSWORD>@geo-clash-industryanalyser.b.aivencloud.com:16068"
cors_origin = "https://your-app.vercel.app"
```

> `terraform/terraform.tfvars` is git-ignored (already added to `.gitignore`).
> Fill in the real `valkey_url` from your Aiven console before running Terraform.

### Step 7 — Install `ioredis` and commit lock file

```bash
npm --prefix server install ioredis
```

Commit the updated `server/package.json` and `server/package-lock.json`.

### Step 8 — Create `server/src/valkeyStore.js`

```js
import Redis from 'ioredis';

// Drop-in replacement for MemoryStore backed by Aiven Valkey.
// Values are JSON-serialised since Valkey stores strings.
export class ValkeyStore {
  constructor(prefix, client) {
    this._prefix = prefix;
    this._client = client;
  }

  _k(key) { return `${this._prefix}:${key}`; }

  async get(key) {
    const raw = await this._client.get(this._k(key));
    return raw === null ? undefined : JSON.parse(raw);
  }

  async set(key, value) {
    await this._client.set(this._k(key), JSON.stringify(value));
    return value;
  }

  async del(key) {
    return (await this._client.del(this._k(key))) > 0;
  }

  async has(key) {
    return (await this._client.exists(this._k(key))) > 0;
  }

  async keys() {
    const pattern = `${this._prefix}:*`;
    const raw = await this._client.keys(pattern);
    return raw.map(k => k.slice(this._prefix.length + 1));
  }

  async all() {
    const ks = await this.keys();
    const entries = await Promise.all(
      ks.map(async k => [k, await this.get(k)])
    );
    return entries;
  }

  async clear() {
    const ks = await this.keys();
    if (ks.length) {
      await this._client.del(ks.map(k => this._k(k)));
    }
  }

  size() {
    // sync size not meaningful for a remote store; safe no-op
    return 0;
  }
}
```

### Step 9 — Update `server/src/memoryStore.js` (replace singleton exports at the bottom)

```js
import { ValkeyStore } from './valkeyStore.js';
import Redis from 'ioredis';

function makeStores() {
  if (process.env.VALKEY_URL) {
    const client = new Redis(process.env.VALKEY_URL, {
      tls: {},            // Aiven requires TLS; ioredis honours rediss:// too
      lazyConnect: false,
    });
    client.on('error', err => console.error('[valkey]', err.message));
    return {
      playerStore: new ValkeyStore('players', client),
      gridStore:   new ValkeyStore('grid', client),
    };
  }
  // Local dev: in-process Maps (no VALKEY_URL set)
  return {
    playerStore: new MemoryStore(),
    gridStore:   new MemoryStore(),
  };
}

export const { playerStore, gridStore } = makeStores();
```

> Aiven's CA is in Node's default TLS bundle — no extra cert config needed.

### Step 10 — Update `client/src/socket.js` (point socket at Cloud Run in prod)

```js
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '/';

export const socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});
```

`VITE_SERVER_URL` unset in dev → falls back to `'/'`, Vite proxy takes over.

### Step 11 — Create `.github/workflows/deploy.yml`

Full content is in the **CI/CD workflow (reference)** section at the bottom.

---

### Agent commit checklist

Before finishing, verify all of the following are staged and committed to `main`:

- [ ] `server/Dockerfile`
- [ ] `server/src/index.js` (CORS from env)
- [ ] `server/src/valkeyStore.js` (new)
- [ ] `server/src/memoryStore.js` (updated exports)
- [ ] `client/src/socket.js` (env-driven server URL)
- [ ] `terraform/variables.tf`
- [ ] `terraform/main.tf`
- [ ] `terraform/outputs.tf`
- [ ] `terraform/terraform.tfvars.example`
- [ ] `.github/workflows/deploy.yml`
- [ ] `server/package.json` + `server/package-lock.json` (ioredis added)

**Do not commit `terraform/terraform.tfvars`** — it is git-ignored.

---

## Phase 2 — Agent: one-time GCP setup via CLI

Run these steps **after** Phase 1 is committed and pushed.

Required CLIs (install if absent):
- `gcloud` — https://cloud.google.com/sdk/docs/install
- `gh` — https://cli.github.com
- `terraform` ≥ 1.7 — https://developer.hashicorp.com/terraform/install
- `vercel` — `npm i -g vercel`

### 2.1 Create Terraform state bucket

```bash
gcloud storage buckets create gs://geo-clash-gc798-tfstate \
  --project=geo-clash-gc798 \
  --location=europe-north2 \
  --uniform-bucket-level-access
```

### 2.2 Create GCP service account for CI

```bash
gcloud iam service-accounts create geo-clash-ci \
  --display-name="Geo Clash CI/CD" \
  --project=geo-clash-gc798

for ROLE in \
  roles/artifactregistry.writer \
  roles/run.admin \
  roles/secretmanager.admin \
  roles/iam.serviceAccountUser \
  roles/resourcemanager.projectIamAdmin \
  roles/serviceusage.serviceUsageAdmin; do
  gcloud projects add-iam-policy-binding geo-clash-gc798 \
    --member="serviceAccount:geo-clash-ci@geo-clash-gc798.iam.gserviceaccount.com" \
    --role="${ROLE}"
done

gcloud storage buckets add-iam-policy-binding gs://geo-clash-gc798-tfstate \
  --member="serviceAccount:geo-clash-ci@geo-clash-gc798.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud iam service-accounts keys create /tmp/geo-clash-ci-key.json \
  --iam-account=geo-clash-ci@geo-clash-gc798.iam.gserviceaccount.com \
  --project=geo-clash-gc798
```

### 2.3 Upload secrets to GitHub

```bash
gh secret set GCP_SA_KEY \
  --body "$(cat /tmp/geo-clash-ci-key.json)"

gh secret set VALKEY_URL \
  --body "rediss://default:<VALKEY_PASSWORD>@geo-clash-industryanalyser.b.aivencloud.com:16068"

# Discover the Vercel project URL and set CORS_ORIGIN
VERCEL_URL=$(vercel ls --json 2>/dev/null | \
  python3 -c "import sys,json; \
  projs=json.load(sys.stdin); \
  print(next(p['alias'][0] for p in projs if 'geo-clash' in p['name']))" \
  2>/dev/null || echo "")

if [ -n "$VERCEL_URL" ]; then
  gh secret set CORS_ORIGIN --body "https://${VERCEL_URL}"
else
  echo "Could not detect Vercel URL — set CORS_ORIGIN secret manually in GitHub"
fi

rm /tmp/geo-clash-ci-key.json
```

### 2.4 Bootstrap Terraform

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars

cd terraform
terraform init
terraform apply -auto-approve -var='image_tag=placeholder'
```

Cloud Run will stay unhealthy until the first real CI push — that's expected.

### 2.5 Trigger CI and wait

```bash
cd ..   # back to repo root
gh workflow run deploy.yml --ref main
gh run watch
```

### 2.6 Wire Vercel to Cloud Run

```bash
CLOUD_RUN_URL=$(terraform -chdir=terraform output -raw cloud_run_url)
echo "Cloud Run URL: $CLOUD_RUN_URL"

# Set VITE_SERVER_URL in Vercel and redeploy
echo "$CLOUD_RUN_URL" | vercel env add VITE_SERVER_URL production --yes
vercel --prod --yes

# Update CORS_ORIGIN to the real Vercel URL
VERCEL_URL=$(vercel inspect --json 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['alias'][0])" \
  2>/dev/null || echo "")

if [ -n "$VERCEL_URL" ]; then
  gh secret set CORS_ORIGIN --body "https://${VERCEL_URL}"
  gh workflow run deploy.yml --ref main
  gh run watch
else
  echo "Set CORS_ORIGIN GitHub secret manually to your Vercel domain, then push to main"
fi
```

---

## CI/CD workflow (reference)

Stored at `.github/workflows/deploy.yml` — created by the agent in Phase 1.

```yaml
name: Deploy

on:
  push:
    branches: [main]

env:
  PROJECT: geo-clash-gc798
  REGION: europe-north2        # update to match your chosen region
  IMAGE_BASE: europe-north2-docker.pkg.dev/geo-clash-gc798/geo-clash/server

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to GCP
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Configure Docker for Artifact Registry
        run: >
          gcloud auth configure-docker
          ${{ env.REGION }}-docker.pkg.dev --quiet

      - name: Build & push Docker image
        run: |
          TAG=$(git rev-parse --short HEAD)
          docker build -t ${{ env.IMAGE_BASE }}:${TAG} ./server
          docker push    ${{ env.IMAGE_BASE }}:${TAG}
          echo "IMAGE_TAG=${TAG}" >> $GITHUB_ENV

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "~> 1.7"

      - name: Terraform init
        run: terraform init
        working-directory: terraform

      - name: Terraform apply
        run: >
          terraform apply -auto-approve
          -var="image_tag=${{ env.IMAGE_TAG }}"
        working-directory: terraform
        env:
          TF_VAR_project: ${{ env.PROJECT }}
          TF_VAR_region: ${{ env.REGION }}
          TF_VAR_valkey_url: ${{ secrets.VALKEY_URL }}
          TF_VAR_cors_origin: ${{ secrets.CORS_ORIGIN }}
```

> **Region note:** update `REGION` and `IMAGE_BASE` if you use a region other
> than `europe-north2`. Both must match `terraform/terraform.tfvars`.

---

## Cost profile

| Resource | Idle cost | Active cost |
|----------|-----------|-------------|
| Cloud Run | **$0** (scales to zero) | ~$0.00002/vCPU-sec + ~$0.000002/GB-sec |
| Artifact Registry | ~$0.10/GB/month (3 images ≈ cents) | — |
| Secret Manager | $0.06/10k accesses; first 10k free | — |
| GCS (TF state) | < $0.01/month (KB of data) | — |
| Aiven Valkey | free tier or ~$19/mo Hobbyist plan | — |
| Vercel | Free tier (100 GB bandwidth/mo) | — |

Total idle cost is effectively **$0**. You only pay during active game sessions.

---

## Known constraints

- **Single Cloud Run instance** (`max_instance_count = 1`) is required until
  the in-process `GameState` tick loop is externalised to Valkey pub/sub.
- **Cold starts** will occur after idle periods (`min_instance_count = 0`).
  Typical Cloud Run cold start is 1–3 s. Acceptable for a playground; set
  `min_instance_count = 1` if you need instant first-connect response.
- Vercel free tier: 100 GB/month bandwidth — fine for an MVP.
