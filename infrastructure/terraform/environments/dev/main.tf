module "platform" {
  source = "../../modules/platform"

  name_prefix        = "aestara-dev"
  vpc_cidr_block     = "10.40.0.0/16"
  availability_zones = [for zone in ["a", "b"] : "${var.region}${zone}"]
  single_nat_gateway = true
  db_instance_class  = "db.t4g.medium"
  db_multi_az        = false
}
