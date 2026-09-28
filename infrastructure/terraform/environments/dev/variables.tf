variable "account_id" {
  description = "AWS account for this environment. One account per environment; Terraform refuses to run against any other."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "region" {
  description = "AWS region. United States only (ADR-0006); us-east-1 is the production region."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^us-(east|west)-[0-9]$", var.region))
    error_message = "Only US commercial regions are allowed (ADR-0006)."
  }
}
