terraform {
  required_version = ">= 1.16.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.66.0"
    }
  }
  # Local state on purpose: this root creates the remote-state bucket. After
  # the first apply, migrate it into that bucket (see README).
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project   = "aestara"
      ManagedBy = "terraform"
      Component = "terraform-state"
    }
  }
}
