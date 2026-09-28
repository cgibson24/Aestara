# Customer-managed KMS keys, one per purpose, so data, media and logs can be
# governed and rotated independently (Bible §21.2, spec §2.3 "KMS customer-managed
# keys per environment").

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  account_root = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"
  region       = data.aws_region.current.region

  purposes = {
    data  = "RDS storage, snapshots, Performance Insights and Secrets Manager"
    media = "Clinical media, export and integration-payload buckets"
    logs  = "CloudWatch Logs and CloudTrail"
  }
}

data "aws_iam_policy_document" "key" {
  # checkov:skip=CKV_AWS_356: In a key policy, Resource "*" means this key only
  # checkov:skip=CKV_AWS_109: Standard account-root key administration statement; access is then governed by IAM
  # checkov:skip=CKV_AWS_111: Standard account-root key administration statement; access is then governed by IAM
  for_each = local.purposes

  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [local.account_root]
    }
  }

  dynamic "statement" {
    for_each = each.key == "logs" ? [1] : []

    content {
      sid       = "CloudWatchLogs"
      actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
      resources = ["*"]

      principals {
        type        = "Service"
        identifiers = ["logs.${local.region}.amazonaws.com"]
      }

      condition {
        test     = "ArnLike"
        variable = "kms:EncryptionContext:aws:logs:arn"
        values   = ["arn:${data.aws_partition.current.partition}:logs:${local.region}:${data.aws_caller_identity.current.account_id}:*"]
      }
    }
  }

  dynamic "statement" {
    for_each = each.key == "logs" ? [1] : []

    content {
      sid       = "CloudTrail"
      actions   = ["kms:GenerateDataKey*", "kms:DescribeKey"]
      resources = ["*"]

      principals {
        type        = "Service"
        identifiers = ["cloudtrail.amazonaws.com"]
      }

      condition {
        test     = "StringLike"
        variable = "kms:EncryptionContext:aws:cloudtrail:arn"
        values   = ["arn:${data.aws_partition.current.partition}:cloudtrail:*:${data.aws_caller_identity.current.account_id}:trail/*"]
      }
    }
  }
}

resource "aws_kms_key" "this" {
  for_each = local.purposes

  description             = "${var.name_prefix} ${each.key}: ${each.value}"
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.key[each.key].json

  tags = { Purpose = each.key }
}

resource "aws_kms_alias" "this" {
  for_each = local.purposes

  name          = "alias/${var.name_prefix}-${each.key}"
  target_key_id = aws_kms_key.this[each.key].key_id
}
