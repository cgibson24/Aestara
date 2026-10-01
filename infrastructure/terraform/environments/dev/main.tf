module "platform" {
  source = "../../modules/platform"

  name_prefix            = "aestara-dev"
  vpc_cidr_block         = "10.40.0.0/16"
  availability_zones     = [for zone in ["a", "b"] : "${var.region}${zone}"]
  single_nat_gateway     = true
  db_instance_class      = "db.t4g.medium"
  trail_object_lock_mode = "GOVERNANCE"
  db_multi_az            = false
  audit_object_lock_mode = "GOVERNANCE"
  audit_object_lock_days = 1
}
