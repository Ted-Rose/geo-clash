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
