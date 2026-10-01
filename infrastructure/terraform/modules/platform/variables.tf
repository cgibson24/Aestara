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

variable "audit_object_lock_mode" {
  description = "The audit archive's Object Lock mode: COMPLIANCE in staging and production; GOVERNANCE in dev (ADR-0023 K2-07)."
  type        = string
}

variable "audit_object_lock_days" {
  description = "The audit archive's retention in days: 2190 (6 years) in staging and production; 1 in dev."
  type        = number
}

variable "malware_scanner" {
  description = "guardduty once GuardDuty Malware Protection is confirmed within the BAA, else clamav (ADR-0023 K2-04)."
  type        = string
  default     = "guardduty"
}
