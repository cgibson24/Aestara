output "platform" {
  description = "Identifiers the application layers need (no secrets: the database secret is referenced by ARN)."
  value = {
    kms_key_arns               = module.platform.kms_key_arns
    vpc_id                     = module.platform.vpc_id
    bucket_names               = module.platform.bucket_names
    ecr_repository_urls        = module.platform.ecr_repository_urls
    ecs_cluster_arn            = module.platform.ecs_cluster_arn
    database_endpoint          = module.platform.database_endpoint
    database_master_secret_arn = module.platform.database_master_secret_arn
    audit_archive_bucket       = module.platform.audit_archive_bucket
    presign_role_arn           = module.platform.presign_role_arn
    event_bus_name             = module.platform.event_bus_name
    queue_urls                 = module.platform.queue_urls
    alerts_topic_arn           = module.platform.alerts_topic_arn
  }
}
