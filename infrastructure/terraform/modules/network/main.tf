# VPC with three subnet tiers per availability zone:
#   public   - load balancer and NAT gateways only
#   private  - ECS tasks (api, workers, ai-gateway); egress through NAT
#   isolated - RDS; no route to the internet
# Flow logs go to CloudWatch encrypted with the logs key (Bible §21.2, §25.3).

locals {
  azs = var.availability_zones

  # /20 per subnet: public 0-2, private 4-6, isolated 8-10 (room to grow).
  public_cidrs   = [for i in range(length(var.availability_zones)) : cidrsubnet(var.cidr_block, 4, i)]
  private_cidrs  = [for i in range(length(var.availability_zones)) : cidrsubnet(var.cidr_block, 4, i + 4)]
  isolated_cidrs = [for i in range(length(var.availability_zones)) : cidrsubnet(var.cidr_block, 4, i + 8)]

  nat_count = var.single_nat_gateway ? 1 : length(var.availability_zones)
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = var.name_prefix }
}

# No rules: nothing may use the default security group.
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-default-deny" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = var.name_prefix }
}

resource "aws_subnet" "public" {
  count = length(var.availability_zones)

  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false

  tags = { Name = "${var.name_prefix}-public-${local.azs[count.index]}", Tier = "public" }
}

resource "aws_subnet" "private" {
  count = length(var.availability_zones)

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = { Name = "${var.name_prefix}-private-${local.azs[count.index]}", Tier = "private" }
}

resource "aws_subnet" "isolated" {
  count = length(var.availability_zones)

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.isolated_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = { Name = "${var.name_prefix}-isolated-${local.azs[count.index]}", Tier = "isolated" }
}

resource "aws_eip" "nat" {
  count  = local.nat_count
  domain = "vpc"

  tags = { Name = "${var.name_prefix}-nat-${count.index}" }
}

resource "aws_nat_gateway" "this" {
  count = local.nat_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = { Name = "${var.name_prefix}-${local.azs[count.index]}" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${var.name_prefix}-public" }
}

resource "aws_route_table_association" "public" {
  count = length(var.availability_zones)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = length(var.availability_zones)
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[var.single_nat_gateway ? 0 : count.index].id
  }

  tags = { Name = "${var.name_prefix}-private-${local.azs[count.index]}" }
}

resource "aws_route_table_association" "private" {
  count = length(var.availability_zones)

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Isolated tier: local VPC routes only.
resource "aws_route_table" "isolated" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-isolated" }
}

resource "aws_route_table_association" "isolated" {
  count = length(var.availability_zones)

  subnet_id      = aws_subnet.isolated[count.index].id
  route_table_id = aws_route_table.isolated.id
}

# S3 traffic from private subnets stays on the AWS network.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id

  tags = { Name = "${var.name_prefix}-s3" }
}

data "aws_region" "current" {}

# --- Flow logs --------------------------------------------------------------

resource "aws_cloudwatch_log_group" "flow_logs" {
  name              = "/aestara/${var.name_prefix}/vpc-flow-logs"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
}

data "aws_iam_policy_document" "flow_logs_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "flow_logs" {
  name               = "${var.name_prefix}-vpc-flow-logs"
  assume_role_policy = data.aws_iam_policy_document.flow_logs_assume.json
}

data "aws_iam_policy_document" "flow_logs" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["${aws_cloudwatch_log_group.flow_logs.arn}:*"]
  }
}

resource "aws_iam_role_policy" "flow_logs" {
  name   = "write-flow-logs"
  role   = aws_iam_role.flow_logs.id
  policy = data.aws_iam_policy_document.flow_logs.json
}

resource "aws_flow_log" "this" {
  vpc_id               = aws_vpc.this.id
  traffic_type         = "ALL"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow_logs.arn
  iam_role_arn         = aws_iam_role.flow_logs.arn
}
