variable "account_id" {
  description = "AWS account that will hold this environment's state."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "environment" {
  description = "dev, staging or production."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be dev, staging or production."
  }
}

variable "region" {
  description = "United States only (ADR-0006)."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^us-(east|west)-[0-9]$", var.region))
    error_message = "Only US commercial regions are allowed (ADR-0006)."
  }
}
