output "bucket_names" {
  description = "Bucket name per purpose."
  value       = { for k, b in aws_s3_bucket.data : k => b.bucket }
}

output "bucket_arns" {
  description = "Bucket ARN per purpose."
  value       = { for k, b in aws_s3_bucket.data : k => b.arn }
}

output "audit_archive_bucket" {
  description = "The audit WORM copy's bucket (Object Lock)."
  value       = aws_s3_bucket.audit_archive.bucket
}

output "presign_role_arn" {
  description = "The role the api and the worker assume to sign device URLs (S3_PRESIGN_ROLE_ARN)."
  value       = aws_iam_role.presign.arn
}

output "malware_protection_plan_arn" {
  description = "The GuardDuty Malware Protection plan, when GuardDuty is the scanner."
  value       = try(aws_guardduty_malware_protection_plan.clinical_media[0].arn, null)
}
