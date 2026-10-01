output "event_bus_name" {
  description = "EVENT_BUS_NAME for the worker."
  value       = aws_cloudwatch_event_bus.this.name
}

output "event_bus_arn" {
  description = "The bus the worker relays to (events:PutEvents)."
  value       = aws_cloudwatch_event_bus.this.arn
}

output "queue_urls" {
  description = "Work queue URL per name (WORKER_EVENTS_QUEUE_URL, IMAGE_JOBS_QUEUE_URL, IMAGE_RESULTS_QUEUE_URL, SCAN_RESULTS_QUEUE_URL)."
  value       = { for k, q in aws_sqs_queue.work : k => q.url }
}

output "queue_arns" {
  description = "Work queue ARN per name, for the task roles' policies."
  value       = { for k, q in aws_sqs_queue.work : k => q.arn }
}

output "alerts_topic_arn" {
  description = "The topic the queue alarms publish to."
  value       = aws_sns_topic.alerts.arn
}
