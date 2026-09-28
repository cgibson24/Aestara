variable "name_prefix" {
  description = "Name prefix for resources, e.g. \"aestara-dev\"."
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR. A /16 leaves room for the /20 subnets."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.cidr_block)) && tonumber(split("/", var.cidr_block)[1]) <= 16
    error_message = "cidr_block must be a valid IPv4 CIDR of /16 or larger."
  }
}

variable "availability_zones" {
  description = "Zones to span, pinned by name so the subnet layout never shifts when AWS adds a zone. Production uses at least two (Bible §25.4)."
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) >= 2 && length(var.availability_zones) <= 4
    error_message = "Use between two and four availability zones."
  }
}

variable "single_nat_gateway" {
  description = "One NAT gateway for all zones (cheaper, for dev) instead of one per zone."
  type        = bool
  default     = false
}

variable "logs_kms_key_arn" {
  description = "KMS key for the flow-log group."
  type        = string
}

variable "log_retention_days" {
  description = "Flow-log retention."
  type        = number
  default     = 365
}
