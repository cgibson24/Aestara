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
  }
}
