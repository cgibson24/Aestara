# Private object storage (spec §7.4, Bible §6.6, §21.2; ADR-0023 K2-04, K2-07, K2-09):
#   clinical-media        every object class except exports and integration payloads;
#                         opaque keys; versioned; deletes and overwrites denied; scanned
#   exports               patient export packages (separate lifecycle and IAM)
#   integration-payloads  raw vendor payloads (separate lifecycle and IAM)
#   audit-archive         the WORM copy of the audit log (Object Lock), written by the worker
# Server access logs go to the account's access-log bucket (account-baseline).
# No bucket is public, and there are no permanent URLs: clients only ever get
# short-lived presigned URLs, signed by the presigning role below.
# Service roles reach object data only through the VPC's S3 endpoint.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  data_buckets = {
    clinical-media       = { deny_delete = true, deny_overwrite = true }
    exports              = { deny_delete = false, deny_overwrite = false }
    integration-payloads = { deny_delete = false, deny_overwrite = false }
  }

  account_id  = data.aws_caller_identity.current.account_id
  partition   = data.aws_partition.current.partition
  bucket_name = { for k in keys(local.data_buckets) : k => "${var.name_prefix}-${k}-${local.account_id}" }

  # Object data actions that must come through the VPC endpoint, except for the
  # presigning role (devices) and GuardDuty (it reads from the AWS network).
  object_data_actions = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]
  endpoint_exempt     = concat([aws_iam_role.presign.arn], [for r in aws_iam_role.malware_protection : r.arn])

  # The object classes devices upload and view (spec §7.4 key layout): Layer 2's
  # photos and their derivatives, and Layer 3's documents (ADR-0026 K3-16).
  presigned_prefixes = ["CLINICAL_ORIGINAL/", "CLINICAL_DERIVATIVE/", "DOCUMENT/"]
  # The roles that sign URLs: the api and the worker (for image-processing) task roles.
  presign_signers = [for service in ["api", "worker"] : "arn:${local.partition}:iam::${local.account_id}:role/${var.name_prefix}-${service}-task"]
  guardduty       = var.malware_scanner == "guardduty"
}

# --- Data buckets -----------------------------------------------------------

resource "aws_s3_bucket" "data" {
  # checkov:skip=CKV_AWS_144: Cross-region replication is a production-readiness item (spec §7.6, roadmap step 14); single region for now (ADR-0006)
  # checkov:skip=CKV2_AWS_62: No bucket notifications: the api verifies uploads on complete-upload (spec §6.1.9) and GuardDuty scans through its own managed rule (K2-04)
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

  # Keys are never overwritten (spec §7.4; K2-09): every PUT must carry
  # If-None-Match: * (S3 conditional writes). GuardDuty's one validation object
  # is the exception.
  dynamic "statement" {
    for_each = each.value.deny_overwrite ? [1] : []

    content {
      sid       = "DenyPutWithoutIfNoneMatch"
      effect    = "Deny"
      actions   = ["s3:PutObject"]
      resources = ["${aws_s3_bucket.data[each.key].arn}/*"]

      principals {
        type        = "*"
        identifiers = ["*"]
      }

      condition {
        test     = "Null"
        variable = "s3:if-none-match"
        values   = ["true"]
      }

      dynamic "condition" {
        for_each = local.guardduty ? [1] : []

        content {
          test     = "ArnNotEquals"
          variable = "aws:PrincipalArn"
          values   = [aws_iam_role.malware_protection[0].arn]
        }
      }
    }
  }

  # An object GuardDuty found infected is never read again, whatever the ledger says.
  dynamic "statement" {
    for_each = each.key == "clinical-media" && local.guardduty ? [1] : []

    content {
      sid       = "DenyReadingInfectedObjects"
      effect    = "Deny"
      actions   = ["s3:GetObject", "s3:GetObjectVersion"]
      resources = ["${aws_s3_bucket.data[each.key].arn}/*"]

      principals {
        type        = "*"
        identifiers = ["*"]
      }

      condition {
        test     = "StringEquals"
        variable = "s3:ExistingObjectTag/GuardDutyMalwareScanStatus"
        values   = ["THREATS_FOUND"]
      }
    }
  }

  statement {
    sid       = "ObjectDataOnlyThroughTheVpcEndpoint"
    effect    = "Deny"
    actions   = local.object_data_actions
    resources = ["${aws_s3_bucket.data[each.key].arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "aws:SourceVpce"
      values   = [var.s3_endpoint_id]
    }

    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = local.endpoint_exempt
    }
  }
}

resource "aws_s3_bucket_policy" "data" {
  for_each = local.data_buckets

  bucket = aws_s3_bucket.data[each.key].id
  policy = data.aws_iam_policy_document.data[each.key].json

  depends_on = [aws_s3_bucket_public_access_block.data]
}

# --- Presigning role (K2-09) -------------------------------------------------
# Devices cannot use the VPC endpoint, so the URLs they receive are signed by
# this role, which the api and the worker assume. It may only put and get the
# clinical object classes, and S3 refuses a signature older than 10 minutes.

data "aws_iam_policy_document" "presign_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:PrincipalArn"
      values   = local.presign_signers
    }
  }
}

resource "aws_iam_role" "presign" {
  name                 = "${var.name_prefix}-media-presign"
  description          = "Signs device upload and view URLs for clinical media (ADR-0023 K2-09)"
  assume_role_policy   = data.aws_iam_policy_document.presign_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "presign" {
  statement {
    sid       = "PutAndGetClinicalObjects"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = [for prefix in local.presigned_prefixes : "${aws_s3_bucket.data["clinical-media"].arn}/${prefix}*"]

    condition {
      test     = "NumericLessThanEquals"
      variable = "s3:signatureAge"
      values   = ["600000"]
    }
  }

  statement {
    sid       = "MediaKeyThroughS3"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [var.media_kms_key_arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "presign" {
  name   = "clinical-media"
  role   = aws_iam_role.presign.id
  policy = data.aws_iam_policy_document.presign.json
}

# --- Malware scanning (K2-04) ------------------------------------------------
# GuardDuty Malware Protection for S3 scans every new original, tags it with the
# result and publishes the result to the default event bus, where
# modules/messaging routes it to the worker. Used only once the owner confirms it
# is within the BAA's scope; otherwise malware_scanner = "clamav" and a ClamAV
# worker behind the same interface replaces it.

data "aws_iam_policy_document" "malware_protection_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["malware-protection-plan.guardduty.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "malware_protection" {
  count = local.guardduty ? 1 : 0

  name               = "${var.name_prefix}-malware-protection"
  description        = "GuardDuty Malware Protection for the clinical-media bucket (ADR-0023 K2-04)"
  assume_role_policy = data.aws_iam_policy_document.malware_protection_trust.json
}

data "aws_iam_policy_document" "malware_protection" {
  statement {
    sid       = "ManagedEventRule"
    actions   = ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets"]
    resources = ["arn:${local.partition}:events:${data.aws_region.current.region}:${local.account_id}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"]

    condition {
      test     = "StringLike"
      variable = "events:ManagedBy"
      values   = ["malware-protection-plan.guardduty.amazonaws.com"]
    }
  }

  statement {
    sid       = "DescribeManagedEventRule"
    actions   = ["events:DescribeRule", "events:ListTargetsByRule"]
    resources = ["arn:${local.partition}:events:${data.aws_region.current.region}:${local.account_id}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"]
  }

  statement {
    sid       = "BucketEventsAndOwnership"
    actions   = ["s3:PutBucketNotification", "s3:GetBucketNotification", "s3:ListBucket"]
    resources = [aws_s3_bucket.data["clinical-media"].arn]
  }

  statement {
    sid       = "ValidationObject"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.data["clinical-media"].arn}/malware-protection-resource-validation-object"]
  }

  statement {
    sid = "ScanAndTag"
    actions = [
      "s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:GetObjectVersionTagging",
      "s3:PutObjectTagging", "s3:PutObjectVersionTagging",
    ]
    resources = ["${aws_s3_bucket.data["clinical-media"].arn}/*"]
  }

  statement {
    sid       = "DecryptForScanning"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [var.media_kms_key_arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "malware_protection" {
  count = local.guardduty ? 1 : 0

  name   = "clinical-media-scanning"
  role   = aws_iam_role.malware_protection[0].id
  policy = data.aws_iam_policy_document.malware_protection.json
}

resource "aws_guardduty_malware_protection_plan" "clinical_media" {
  count = local.guardduty ? 1 : 0

  role = aws_iam_role.malware_protection[0].arn

  protected_resource {
    s3_bucket {
      bucket_name     = aws_s3_bucket.data["clinical-media"].bucket
      object_prefixes = var.scanned_prefixes
    }
  }

  actions {
    tagging {
      status = "ENABLED"
    }
  }

  depends_on = [aws_iam_role_policy.malware_protection]
}

# --- Audit archive (K2-07) ---------------------------------------------------
# The WORM copy of the application audit log: the worker writes one JSON-lines
# object per batch and day, and Object Lock keeps each for the retention
# period (compliance mode for 6 years in staging and production).

resource "aws_s3_bucket" "audit_archive" {
  # checkov:skip=CKV_AWS_144: Cross-region replication is a production-readiness item (spec §7.6, roadmap step 14); single region for now (ADR-0006)
  # checkov:skip=CKV2_AWS_62: No consumers of new objects: the worker's daily reconciliation reads the archive
  bucket              = "${var.name_prefix}-audit-archive-${local.account_id}"
  object_lock_enabled = true

  tags = { Purpose = "audit-archive" }
}

resource "aws_s3_bucket_public_access_block" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id

  rule {
    default_retention {
      mode = var.audit_object_lock_mode
      days = var.audit_object_lock_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.audit_archive]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.audit_kms_key_arn
    }
  }
}

resource "aws_s3_bucket_logging" "audit_archive" {
  bucket        = aws_s3_bucket.audit_archive.id
  target_bucket = var.access_log_bucket
  target_prefix = "audit-archive/"
}

resource "aws_s3_bucket_lifecycle_configuration" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "audit_archive" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.audit_archive.arn, "${aws_s3_bucket.audit_archive.arn}/*"]

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
    sid       = "DenyPutWithoutIfNoneMatch"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit_archive.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Null"
      variable = "s3:if-none-match"
      values   = ["true"]
    }
  }

  statement {
    sid       = "DenyWrongEncryptionKey"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit_archive.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEqualsIfExists"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [var.audit_kms_key_arn]
    }
  }

  statement {
    sid       = "ObjectDataOnlyThroughTheVpcEndpoint"
    effect    = "Deny"
    actions   = local.object_data_actions
    resources = ["${aws_s3_bucket.audit_archive.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "aws:SourceVpce"
      values   = [var.s3_endpoint_id]
    }
  }
}

resource "aws_s3_bucket_policy" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id
  policy = data.aws_iam_policy_document.audit_archive.json

  depends_on = [aws_s3_bucket_public_access_block.audit_archive]
}
