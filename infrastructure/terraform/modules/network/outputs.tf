output "vpc_id" {
  value = aws_vpc.this.id
}

output "vpc_cidr_block" {
  value = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "isolated_subnet_ids" {
  value = aws_subnet.isolated[*].id
}

output "s3_endpoint_id" {
  description = "The S3 gateway endpoint; service roles reach the data buckets only through it (ADR-0023 K2-09)."
  value       = aws_vpc_endpoint.s3.id
}
