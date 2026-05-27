terraform {
  required_version = ">= 1.5"
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
    "iam.googleapis.com",
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
    most_recent_versions {
      keep_count = 3
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
  image = (
    var.image_tag == "placeholder"
    ? "us-docker.pkg.dev/cloudrun/container/hello:latest"
    : "${local.image_base}:${var.image_tag}"
  )
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
    timeout         = "3600s"  # allow long-lived Socket.io connections (up to 60 min)

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
        cpu_idle          = true  # bill CPU only while requests are in flight
        startup_cpu_boost = true  # faster cold starts (free)
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
