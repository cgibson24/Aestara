variable "name_prefix" {
  description = "Name prefix, e.g. \"aestara-dev\"."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr_block" {
  type = string
}

variable "services" {
  description = "Deployable services (Bible §25.2, repository services/)."
  type        = list(string)
  default     = ["api", "ai-gateway", "image-processing", "notifications", "integration-service"]
}

variable "data_kms_key_arn" {
  description = "KMS key for ECR image encryption."
  type        = string
}

variable "logs_kms_key_arn" {
  description = "KMS key for service log groups."
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 365
}
