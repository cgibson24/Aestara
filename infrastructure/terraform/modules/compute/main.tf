# Container platform (spec §2.3, Bible §25.3): an ECS cluster for Fargate
# services, one ECR repository and log group per service, and the security
# group application tasks run in. Services, task definitions, the load
# balancer and WAF are added by the layer that first deploys a service
# (api: Layer 1); nothing runs here in Layer 0.

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_ecr_repository" "service" {
  for_each = toset(var.services)

  name                 = "${var.name_prefix}/${each.value}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.data_kms_key_arn
  }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each = aws_ecr_repository.service

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images after 14 days"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 14
      }
      action = { type = "expire" }
    }]
  })
}

# Application logs are structured and PHI-filtered before they leave the
# process (Bible §26, spec §7.2); the group is still encrypted.
resource "aws_cloudwatch_log_group" "service" {
  for_each = toset(var.services)

  name              = "/aestara/${var.name_prefix}/${each.value}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
}

resource "aws_security_group" "tasks" {
  # checkov:skip=CKV2_AWS_5: Attached to ECS services when the api deploys (Layer 1)
  name        = "${var.name_prefix}-tasks"
  description = "Application tasks: no inbound until a load balancer is added; HTTPS and PostgreSQL outbound"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-tasks" }
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.tasks.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS to AWS APIs and approved vendors (via NAT or VPC endpoints)"
}

resource "aws_vpc_security_group_egress_rule" "postgres" {
  security_group_id = aws_security_group.tasks.id
  cidr_ipv4         = var.vpc_cidr_block
  ip_protocol       = "tcp"
  from_port         = 5432
  to_port           = 5432
  description       = "PostgreSQL inside the VPC"
}
