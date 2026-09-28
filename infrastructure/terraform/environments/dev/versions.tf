terraform {
  required_version = ">= 1.16.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.66.0"
    }
  }

  # Partial configuration: the state bucket comes from the bootstrap root.
  #   terraform init -backend-config=bucket=<state bucket from bootstrap>
  backend "s3" {
    key          = "environments/dev/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project     = "aestara"
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}
