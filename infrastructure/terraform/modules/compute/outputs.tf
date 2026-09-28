output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "repository_urls" {
  description = "ECR repository URL per service."
  value       = { for name, repo in aws_ecr_repository.service : name => repo.repository_url }
}

output "tasks_security_group_id" {
  value = aws_security_group.tasks.id
}
