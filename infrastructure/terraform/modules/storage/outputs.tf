output "bucket_names" {
  description = "Bucket name per purpose."
  value       = { for k, b in aws_s3_bucket.data : k => b.bucket }
}

output "bucket_arns" {
  description = "Bucket ARN per purpose."
  value       = { for k, b in aws_s3_bucket.data : k => b.arn }
}
