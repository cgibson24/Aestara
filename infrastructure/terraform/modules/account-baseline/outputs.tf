output "cloudtrail_arn" {
  value = aws_cloudtrail.this.arn
}

output "cloudtrail_bucket" {
  value = aws_s3_bucket.trail.bucket
}

output "guardduty_detector_id" {
  value = aws_guardduty_detector.this.id
}

output "access_log_bucket" {
  description = "Bucket for S3 server access logs."
  value       = aws_s3_bucket.access_logs.bucket
}
