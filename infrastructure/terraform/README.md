# Infrastructure as code

Terraform root modules per environment (dev, staging, production) on AWS: VPC, KMS, S3, RDS PostgreSQL, ECS, SQS/EventBridge, CloudFront/WAF, CloudTrail.

**Status:** placeholder. No code yet, by design: the Bible forbids fake business implementations (§0.1, §31).

**Built in:** Skeleton in Step 3 (Layer 0 completion) with `terraform validate`, `tflint` and `checkov` in CI.

HIPAA-eligible services only; us-east-1 (ADR-0006).

Roadmap: `docs/DEVELOPMENT_ROADMAP.md`.
