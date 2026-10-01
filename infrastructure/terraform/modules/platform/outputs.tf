output "kms_key_arns" {
  value = module.kms.key_arns
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "bucket_names" {
  value = module.storage.bucket_names
}

output "ecr_repository_urls" {
  value = module.compute.repository_urls
}

output "ecs_cluster_arn" {
  value = module.compute.cluster_arn
}

output "database_endpoint" {
  value = module.database.endpoint
}

output "database_master_secret_arn" {
  value = module.database.master_user_secret_arn
}

output "audit_archive_bucket" {
  value = module.storage.audit_archive_bucket
}

output "presign_role_arn" {
  value = module.storage.presign_role_arn
}

output "event_bus_name" {
  value = module.messaging.event_bus_name
}

output "queue_urls" {
  value = module.messaging.queue_urls
}

output "alerts_topic_arn" {
  value = module.messaging.alerts_topic_arn
}
