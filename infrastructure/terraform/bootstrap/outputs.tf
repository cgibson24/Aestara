output "state_bucket" {
  description = "Pass to the environment root: terraform init -backend-config=bucket=<this>."
  value       = aws_s3_bucket.state.bucket
}
