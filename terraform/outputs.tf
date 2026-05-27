output "artifact_registry_repo" {
  description = "Full Artifact Registry image base path"
  value       = "${var.region}-docker.pkg.dev/${var.project}/geo-clash/server"
}

output "cloud_run_url" {
  description = "Public Cloud Run service URL — use as VITE_SERVER_URL in Vercel"
  value       = google_cloud_run_v2_service.server.uri
}
