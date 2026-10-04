# Events and queues for the transactional outbox and the Layer 2 workers
# (spec §2.1 "Queues & events", §3.3, §6.7; ADR-0023 K2-04, K2-06, K2-07).
#
#   event bus (custom)  the worker relays committed outbox rows here (source aestara.api)
#   worker-events       image.derivative.requested and image.registration.requested,
#                       routed from the bus, read by the worker
#   image-jobs          the worker's jobs for image-processing
#   image-results       image-processing's results, read by the worker
#   scan-results        GuardDuty Malware Protection results from the default bus
#
# Every queue has a dead-letter queue after 5 receives and an alarm on it; the
# work queues also alarm when their oldest message waits over 15 minutes.
# Messages carry IDs and presigned URLs only, never PHI, and are encrypted
# with the messaging key. The local emulator mirrors this layout
# (services/api/src/aws/local-resources.ts).

locals {
  max_receives = 5

  queues = {
    worker-events = { visibility = 60, source = "bus" }
    image-jobs    = { visibility = 120, source = "worker" }
    image-results = { visibility = 60, source = "image-processing" }
    scan-results  = { visibility = 60, source = "guardduty" }
  }

  # The api events the worker consumes, by detail type.
  worker_event_types = ["image.derivative.requested", "image.registration.requested"]
}

resource "aws_cloudwatch_event_bus" "this" {
  name               = var.name_prefix
  kms_key_identifier = var.kms_key_arn
}

# --- Queues -----------------------------------------------------------------

resource "aws_sqs_queue" "dead_letter" {
  for_each = local.queues

  name                              = "${var.name_prefix}-${each.key}-dlq"
  message_retention_seconds         = 1209600
  kms_master_key_id                 = var.kms_key_arn
  kms_data_key_reuse_period_seconds = 300
}

resource "aws_sqs_queue" "work" {
  for_each = local.queues

  name                              = "${var.name_prefix}-${each.key}"
  visibility_timeout_seconds        = each.value.visibility
  message_retention_seconds         = 345600
  receive_wait_time_seconds         = 20
  kms_master_key_id                 = var.kms_key_arn
  kms_data_key_reuse_period_seconds = 300

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter[each.key].arn
    maxReceiveCount     = local.max_receives
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dead_letter" {
  for_each = local.queues

  queue_url = aws_sqs_queue.dead_letter[each.key].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.work[each.key].arn]
  })
}

# Events the bus could not deliver to a queue.
resource "aws_sqs_queue" "undeliverable_events" {
  name                              = "${var.name_prefix}-undeliverable-events"
  message_retention_seconds         = 1209600
  kms_master_key_id                 = var.kms_key_arn
  kms_data_key_reuse_period_seconds = 300
}

# --- Routing ----------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "worker_events" {
  name           = "${var.name_prefix}-worker-events"
  description    = "api events the worker consumes"
  event_bus_name = aws_cloudwatch_event_bus.this.name
  event_pattern = jsonencode({
    source        = ["aestara.api"]
    "detail-type" = local.worker_event_types
  })
}

resource "aws_cloudwatch_event_target" "worker_events" {
  rule           = aws_cloudwatch_event_rule.worker_events.name
  event_bus_name = aws_cloudwatch_event_bus.this.name
  arn            = aws_sqs_queue.work["worker-events"].arn

  retry_policy {
    maximum_event_age_in_seconds = 86400
    maximum_retry_attempts       = 185
  }

  dead_letter_config {
    arn = aws_sqs_queue.undeliverable_events.arn
  }
}

# GuardDuty publishes scan results to the default bus.
resource "aws_cloudwatch_event_rule" "scan_results" {
  count = var.malware_scanner == "guardduty" ? 1 : 0

  name        = "${var.name_prefix}-scan-results"
  description = "GuardDuty Malware Protection results for the clinical-media bucket (K2-04)"
  event_pattern = jsonencode({
    source        = ["aws.guardduty"]
    "detail-type" = ["GuardDuty Malware Protection Object Scan Result"]
    detail = {
      s3ObjectDetails = { bucketName = [var.media_bucket_name] }
    }
  })
}

resource "aws_cloudwatch_event_target" "scan_results" {
  count = var.malware_scanner == "guardduty" ? 1 : 0

  rule = aws_cloudwatch_event_rule.scan_results[0].name
  arn  = aws_sqs_queue.work["scan-results"].arn

  retry_policy {
    maximum_event_age_in_seconds = 86400
    maximum_retry_attempts       = 185
  }

  dead_letter_config {
    arn = aws_sqs_queue.undeliverable_events.arn
  }
}

# --- Queue policies -----------------------------------------------------------

locals {
  rule_for_queue = merge(
    { worker-events = aws_cloudwatch_event_rule.worker_events.arn },
    var.malware_scanner == "guardduty" ? { scan-results = aws_cloudwatch_event_rule.scan_results[0].arn } : {},
  )
  undeliverable_sources = values(local.rule_for_queue)
}

data "aws_iam_policy_document" "work" {
  for_each = local.queues

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["sqs:*"]
    resources = [aws_sqs_queue.work[each.key].arn]

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

  dynamic "statement" {
    for_each = contains(keys(local.rule_for_queue), each.key) ? [1] : []

    content {
      sid       = "EventBridgeDelivers"
      actions   = ["sqs:SendMessage"]
      resources = [aws_sqs_queue.work[each.key].arn]

      principals {
        type        = "Service"
        identifiers = ["events.amazonaws.com"]
      }

      condition {
        test     = "ArnEquals"
        variable = "aws:SourceArn"
        values   = [local.rule_for_queue[each.key]]
      }
    }
  }
}

resource "aws_sqs_queue_policy" "work" {
  for_each = local.queues

  queue_url = aws_sqs_queue.work[each.key].id
  policy    = data.aws_iam_policy_document.work[each.key].json
}

data "aws_iam_policy_document" "undeliverable_events" {
  statement {
    sid       = "EventBridgeDeadLetters"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.undeliverable_events.arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = local.undeliverable_sources
    }
  }
}

resource "aws_sqs_queue_policy" "undeliverable_events" {
  queue_url = aws_sqs_queue.undeliverable_events.id
  policy    = data.aws_iam_policy_document.undeliverable_events.json
}

# --- Alarms -----------------------------------------------------------------
# Subscriptions to the alerts topic are an operations choice made at deployment
# (DEPLOYMENT.md); the alarms carry queue names only.

resource "aws_sns_topic" "alerts" {
  name              = "${var.name_prefix}-messaging-alerts"
  kms_master_key_id = var.kms_key_arn
}

resource "aws_cloudwatch_metric_alarm" "dead_letters" {
  for_each = merge(
    { for k, q in aws_sqs_queue.dead_letter : k => q.name },
    { undeliverable-events = aws_sqs_queue.undeliverable_events.name },
  )

  alarm_name          = "${each.value}-not-empty"
  alarm_description   = "Messages reached a dead-letter queue: a consumer could not process them (ADR-0023 K2-06)"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.value }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "backlog" {
  for_each = aws_sqs_queue.work

  alarm_name          = "${each.value.name}-backlog"
  alarm_description   = "The oldest message has waited over 15 minutes: its consumer is down or too slow"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = each.value.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 900
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
