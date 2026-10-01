module "platform" {
  source = "../../modules/platform"

  name_prefix            = "aestara-staging"
  vpc_cidr_block         = "10.41.0.0/16"
  availability_zones     = [for zone in ["a", "b", "c"] : "${var.region}${zone}"]
  single_nat_gateway     = false
  db_instance_class      = "db.t4g.large"
  trail_object_lock_mode = "COMPLIANCE"
  db_multi_az            = true
  audit_object_lock_mode = "COMPLIANCE"
  audit_object_lock_days = 2190
}
