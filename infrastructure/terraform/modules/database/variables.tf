variable "name_prefix" {
  description = "Identifier prefix, e.g. \"aestara-dev\"."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Isolated subnets (no internet route), at least two zones."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "RDS needs subnets in at least two availability zones."
  }
}

variable "allowed_security_group_ids" {
  description = "Security groups allowed to connect on 5432 (application tasks)."
  type        = list(string)
  default     = []
}

variable "data_kms_key_arn" {
  description = "KMS key for storage, the master-user secret and Performance Insights."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL version prefix; RDS picks the current minor and upgrades it automatically."
  type        = string
  default     = "18"

  validation {
    condition     = tonumber(split(".", var.engine_version)[0]) >= 15
    error_message = "PostgreSQL 15 or later is required (spec §2.1)."
  }
}

variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "allocated_storage_gb" {
  type    = number
  default = 50
}

variable "max_allocated_storage_gb" {
  description = "Storage autoscaling ceiling."
  type        = number
  default     = 500
}

variable "multi_az" {
  description = "Standby in a second zone. Required for staging and production (Bible §25.4)."
  type        = bool
  default     = true
}
