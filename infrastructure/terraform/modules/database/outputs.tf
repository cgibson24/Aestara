output "endpoint" {
  description = "Host:port for the api (TLS required)."
  value       = aws_db_instance.this.endpoint
}

output "master_user_secret_arn" {
  description = "Secrets Manager secret holding the master credentials."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "security_group_id" {
  value = aws_security_group.db.id
}
