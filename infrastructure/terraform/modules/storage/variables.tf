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

variable "s3_endpoint_id" {
  description = "The VPC's S3 gateway endpoint; service roles reach object data only through it (ADR-0023 K2-09)."
  type        = string
}

variable "audit_kms_key_arn" {
  description = "KMS key for the audit-archive bucket (the logs key)."
  type        = string
}

variable "audit_object_lock_mode" {
  description = "Object Lock mode of the audit archive: COMPLIANCE in staging and production, GOVERNANCE in dev (ADR-0023 K2-07)."
  type        = string

  validation {
    condition     = contains(["COMPLIANCE", "GOVERNANCE"], var.audit_object_lock_mode)
    error_message = "COMPLIANCE or GOVERNANCE."
  }
}

variable "audit_object_lock_days" {
  description = "Object Lock retention of the audit archive: 2190 days (6 years) in staging and production, 1 in dev."
  type        = number
}

variable "malware_scanner" {
  description = "guardduty (GuardDuty Malware Protection for S3, once confirmed within the BAA) or clamav (ADR-0023 K2-04)."
  type        = string
  default     = "guardduty"

  validation {
    condition     = contains(["guardduty", "clamav"], var.malware_scanner)
    error_message = "guardduty or clamav."
  }
}

variable "scanned_prefixes" {
  description = "Object key prefixes GuardDuty scans: the uploaded object classes (K2-04, K3-16). Layer 5 adds patient uploads and attachments."
  type        = list(string)
  default     = ["CLINICAL_ORIGINAL/", "DOCUMENT/"]
}
