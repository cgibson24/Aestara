# One environment's platform: keys, account guardrails, network, storage,
# messaging, container platform and database. Environment roots call this module with
# their sizing; the architecture is identical everywhere (Bible §28.1).

module "kms" {
  source = "../kms"

  name_prefix = var.name_prefix
}

module "account_baseline" {
  source = "../account-baseline"

  name_prefix            = var.name_prefix
  logs_kms_key_arn       = module.kms.key_arns["logs"]
  trail_object_lock_mode = var.trail_object_lock_mode
}

module "network" {
  source = "../network"

  name_prefix        = var.name_prefix
  cidr_block         = var.vpc_cidr_block
  availability_zones = var.availability_zones
  single_nat_gateway = var.single_nat_gateway
  logs_kms_key_arn   = module.kms.key_arns["logs"]
}

module "storage" {
  source = "../storage"

  name_prefix            = var.name_prefix
  media_kms_key_arn      = module.kms.key_arns["media"]
  audit_kms_key_arn      = module.kms.key_arns["logs"]
  access_log_bucket      = module.account_baseline.access_log_bucket
  s3_endpoint_id         = module.network.s3_endpoint_id
  audit_object_lock_mode = var.audit_object_lock_mode
  audit_object_lock_days = var.audit_object_lock_days
  malware_scanner        = var.malware_scanner
}

module "messaging" {
  source = "../messaging"

  name_prefix       = var.name_prefix
  kms_key_arn       = module.kms.key_arns["messaging"]
  media_bucket_name = module.storage.bucket_names["clinical-media"]
  malware_scanner   = var.malware_scanner
}

module "compute" {
  source = "../compute"

  name_prefix      = var.name_prefix
  vpc_id           = module.network.vpc_id
  vpc_cidr_block   = module.network.vpc_cidr_block
  data_kms_key_arn = module.kms.key_arns["data"]
  logs_kms_key_arn = module.kms.key_arns["logs"]
}

module "database" {
  source = "../database"

  name_prefix                = var.name_prefix
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.isolated_subnet_ids
  allowed_security_group_ids = [module.compute.tasks_security_group_id]
  data_kms_key_arn           = module.kms.key_arns["data"]
  instance_class             = var.db_instance_class
  multi_az                   = var.db_multi_az
}
