variable "name_prefix" {
  description = "Name prefix, e.g. \"aestara-dev\"; also the event bus name (EVENT_BUS_NAME)."
  type        = string
}

variable "kms_key_arn" {
  description = "The messaging key: queues, the event bus and the alerts topic."
  type        = string
}

variable "media_bucket_name" {
  description = "The clinical-media bucket whose scan results are routed to the worker."
  type        = string
}

variable "malware_scanner" {
  description = "guardduty or clamav (ADR-0023 K2-04); the scan-results rule exists for guardduty only."
  type        = string
  default     = "guardduty"

  validation {
    condition     = contains(["guardduty", "clamav"], var.malware_scanner)
    error_message = "guardduty or clamav."
  }
}
