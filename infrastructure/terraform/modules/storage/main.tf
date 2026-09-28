# Private object storage (spec §7.4, Bible §6.6, §21.2):
#   clinical-media        originals and derivatives; opaque keys; versioned; deletes denied
#   exports               patient export packages (separate lifecycle and IAM)
#   integration-payloads  raw vendor payloads (separate lifecycle and IAM)
# Server access logs go to the account's access-log bucket (account-baseline).
# No bucket is public, and there are no permanent URLs: clients only ever get
# short-lived presigned URLs from the api.

data "aws_caller_identity" "current" {}

locals {
  data_buckets = {
    clinical-media       = { deny_delete = true }
    exports              = { deny_delete = false }
    integration-payloads = { deny_delete = false }
  }

  bucket_name = { for k in keys(local.data_buckets) : k => "${var.name_prefix}-${k}-${data.aws_caller_identity.current.account_id}" }
}

# --- Data buckets -----------------------------------------------------------

resource "aws_s3_bucket" "data" {
  # checkov:skip=CKV_AWS_144: Cross-region replication is a production-readiness item (spec §7.6, roadmap step 14); single region for now (ADR-0006)
  # checkov:skip=CKV2_AWS_62: No S3 event consumers: uploads are verified by the api on complete-upload (spec §6.1.9)
  for_each = local.data_buckets

  bucket = local.bucket_name[each.key]

  tags = { Purpose = each.key }
}

resource "aws_s3_bucket_public_access_block" "data" {
  for_each = local.data_buckets

  bucket = aws_s3_bucket.data[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "data" {
  for_each = local.data_buckets

  bucket = aws_s3_bucket.data[each.key].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "data" {
  for_each = local.data_buckets

  bucket = aws_s3_bucket.data[each.key].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  for_each = local.data_buckets

  bucket = aws_s3_bucket.data[each.key].id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.media_kms_key_arn
    }
  }
}

resource "aws_s3_bucket_logging" "data" {
  for_each = local.data_buckets

  bucket        = aws_s3_bucket.data[each.key].id
  target_bucket = var.access_log_bucket
  target_prefix = "${each.key}/"
}

# Retention is a customer policy decision (UD-24): no automatic expiry of
# data. Only abandoned multipart uploads are cleaned up.
resource "aws_s3_bucket_lifecycle_configuration" "data" {
  for_each = local.data_buckets

  bucket = aws_s3_bucket.data[each.key].id

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "data" {
  for_each = local.data_buckets

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.data[each.key].arn, "${aws_s3_bucket.data[each.key].arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyWrongEncryptionKey"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.data[each.key].arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEqualsIfExists"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [var.media_kms_key_arn]
    }
  }

  # Originals are never deleted by application roles (Bible §6.6, spec §7.4).
  # With no approved principals (the default) nobody may delete; a future
  # retention job is added to media_delete_principal_arns once UD-24 is decided.
  dynamic "statement" {
    for_each = each.value.deny_delete ? [1] : []

    content {
      sid       = "DenyDeleteExceptApprovedPrincipals"
      effect    = "Deny"
      actions   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
      resources = ["${aws_s3_bucket.data[each.key].arn}/*"]

      principals {
        type        = "*"
        identifiers = ["*"]
      }

      dynamic "condition" {
        for_each = length(var.media_delete_principal_arns) > 0 ? [1] : []

        content {
          test     = "ArnNotLike"
          variable = "aws:PrincipalArn"
          values   = var.media_delete_principal_arns
        }
      }
    }
  }
}

resource "aws_s3_bucket_policy" "data" {
  for_each = local.data_buckets

  bucket = aws_s3_bucket.data[each.key].id
  policy = data.aws_iam_policy_document.data[each.key].json

  depends_on = [aws_s3_bucket_public_access_block.data]
}
