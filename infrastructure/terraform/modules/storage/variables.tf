variable "name_prefix" {
  description = "Bucket name prefix, e.g. \"aestara-dev\". The account ID is appended for global uniqueness."
  type        = string
}

variable "media_kms_key_arn" {
  description = "KMS key for the clinical-media, exports and integration-payloads buckets."
  type        = string
}

variable "media_delete_principal_arns" {
  description = "IAM principal ARNs allowed to delete clinical media. Empty by default: nobody may delete (UD-24)."
  type        = list(string)
  default     = []
}

variable "access_log_bucket" {
  description = "Bucket receiving S3 server access logs (from account-baseline)."
  type        = string
}
