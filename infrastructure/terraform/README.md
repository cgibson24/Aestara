# Infrastructure as code

Terraform for AWS in the United States only (ADR-0006), using HIPAA-eligible services configured for regulated data. The full design is in [`docs/INFRASTRUCTURE.md`](../../docs/INFRASTRUCTURE.md) and the release process in [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

> Using AWS for protected health information also requires a signed AWS Business Associate Addendum and the operator's policies. Code alone does not make a deployment compliant (Bible §21.3).

## Layout

| Path | What |
|---|---|
| `bootstrap/` | Creates one account's remote-state bucket and its KMS key. Local state, run once per account. |
| `environments/{dev,staging,production}/` | One root per environment, each in **its own AWS account**. Each calls `modules/platform` with its sizing. |
| `modules/platform/` | Composes the modules below into one environment. |
| `modules/kms/` | Customer-managed keys per purpose: `data`, `media`, `logs`. Rotation is on. |
| `modules/account-baseline/` | Account-wide S3 public-access block, default EBS encryption, a multi-region CloudTrail with log-file validation, GuardDuty, IAM Access Analyzer, and the access-log bucket. |
| `modules/network/` | VPC with public, private and isolated subnets across pinned zones. It also has NAT, flow logs and an S3 gateway endpoint. |
| `modules/storage/` | Private buckets for clinical media, exports and integration payloads. They are KMS-encrypted, versioned and TLS-only, and clinical media cannot be deleted. |
| `modules/database/` | RDS PostgreSQL 18 in the isolated subnets. It enforces TLS, uses a Secrets Manager–managed password and keeps 35-day backups with PITR. Multi-AZ in staging and production. |
| `modules/compute/` | ECS cluster (Fargate), one ECR repository and log group per service, and the task security group. |

Layer 0 creates no running service. Each later layer adds what it first needs:
- **Layer 1:** the api task definition and service, ALB, WAF and ACM certificate.
- **Layer 2:** SQS/EventBridge for the outbox.
- **Admin web:** CloudFront for its static site.

## Prerequisites

- Terraform **1.16.4**. The environments pin the AWS provider to exactly **6.66.0**. Lock files are committed.
- AWS credentials for the target account, obtained through SSO or an assumed role. Never use long-lived keys.
- tflint 0.64.0 with the AWS ruleset 0.49.0, and checkov 3.3.20. CI runs the same versions.

## Commands

```bash
# One-time per account: remote state
cd infrastructure/terraform/bootstrap
terraform init
terraform apply -var account_id=<12-digit id> -var environment=dev
# optional: move bootstrap state into the new bucket (add a backend "s3" block, then terraform init -migrate-state)

# Each environment
cd ../environments/dev
cp example.tfvars terraform.tfvars                  # set account_id (file is git-ignored)
terraform init -backend-config=bucket=<state_bucket output from bootstrap>
terraform plan -out=tfplan                          # reviewed before any apply (Bible §28.2)
terraform apply tfplan

# Checks (what CI runs; no AWS credentials needed)
terraform fmt -recursive -check
terraform -chdir=environments/dev init -backend=false && terraform -chdir=environments/dev validate
tflint --init && tflint --recursive --config "$PWD/.tflint.hcl"
checkov -d . --framework terraform --quiet --compact
```

The committed lock files carry Linux checksums. On a Mac, run `terraform providers lock -platform=darwin_arm64 -platform=linux_amd64` once to add yours.

## Rules

- Every checkov suppression is inline, beside the resource, with its reason. Add a new one only with a written justification that is reviewed like code.
- No secrets in Terraform: database credentials live in Secrets Manager, created by RDS (`manage_master_user_password`).
- Buckets are never public, and patient media is never cached on a public CDN (Bible §25.3).
- Retention is a customer policy decision (UD-24), so there is no automatic expiry of clinical data.
