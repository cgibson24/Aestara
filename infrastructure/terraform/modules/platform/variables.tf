variable "name_prefix" {
  description = "Name prefix, e.g. \"aestara-dev\"."
  type        = string
}

variable "vpc_cidr_block" {
  type = string
}

variable "availability_zones" {
  type = list(string)
}

variable "single_nat_gateway" {
  type = bool
}

variable "db_instance_class" {
  type = string
}

variable "db_multi_az" {
  type = bool
}

variable "trail_object_lock_mode" {
  description = "COMPLIANCE in staging and production; GOVERNANCE in dev."
  type        = string
}
