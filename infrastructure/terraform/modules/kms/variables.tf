variable "name_prefix" {
  description = "Prefix for key aliases, e.g. \"aestara-dev\"."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,40}$", var.name_prefix))
    error_message = "name_prefix must be lowercase letters, digits and hyphens."
  }
}
