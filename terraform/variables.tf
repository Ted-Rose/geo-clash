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

# Allowed browser origin(s) for Express CORS + the Socket.io handshake,
# comma-separated. An entry containing '*' becomes a pattern where '*'
# matches one hostname run ([a-z0-9-]+) — the default keeps this
# project's Vercel preview deployments working. A bare '*' reflects
# every origin — dev only, never in prod.
variable "cors_origin" {
  description = "Allowed CORS origin(s), comma-separated"
  type        = string
  # >79-char line justified: variable defaults must be literals and HCL
  # has no string continuation, so the origin list stays on one line.
  default = "https://geoclashers.vercel.app,https://geo-clash-*-industr-analysers-projects.vercel.app"
}

# Public Sentry client key (DSN) for the server project — DSNs are
# public-by-design (they only allow event ingestion), so this rides a
# plain variable + env var, not Secret Manager. Empty disables Sentry
# entirely: the server starts clean and every capture call no-ops.
variable "sentry_dsn" {
  description = "Sentry DSN for geo-clash-server; empty disables Sentry"
  type        = string
  default     = ""
}
