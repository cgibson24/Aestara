variable "name_prefix" {
  description = "Name prefix, e.g. \"aestara-dev\"."
  type        = string
}

variable "logs_kms_key_arn" {
  description = "KMS key for CloudTrail files and log groups."
  type        = string
}

variable "trail_retention_days" {
  description = "CloudTrail file retention. Six years by default, matching HIPAA documentation retention."
  type        = number
  default     = 2190
}

variable "log_retention_days" {
  description = "CloudTrail log-group retention in CloudWatch."
  type        = number
  default     = 365
}

variable "access_log_retention_days" {
  description = "Retention of S3 server access logs."
  type        = number
  default     = 365
}
