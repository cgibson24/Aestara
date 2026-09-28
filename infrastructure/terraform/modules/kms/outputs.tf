output "key_arns" {
  description = "KMS key ARN per purpose (data, media, logs)."
  value       = { for purpose, key in aws_kms_key.this : purpose => key.arn }
}
