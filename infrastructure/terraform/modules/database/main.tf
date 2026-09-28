# PostgreSQL 18 on RDS (spec §2.1, Bible §25.3–25.4): isolated subnets, KMS
# encryption, TLS required, credentials held by Secrets Manager (never in
# state or code), 35-day backups with point-in-time recovery, deletion
# protection. Multi-AZ in staging and production.

resource "aws_db_subnet_group" "this" {
  name       = var.name_prefix
  subnet_ids = var.subnet_ids

  tags = { Name = var.name_prefix }
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db"
  description = "PostgreSQL: reachable only from application security groups"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "from_app" {
  for_each = toset(var.allowed_security_group_ids)

  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL from application tasks"
}

resource "aws_db_parameter_group" "this" {
  name        = "${var.name_prefix}-postgres18"
  family      = "postgres18"
  description = "Aestara PostgreSQL 18 parameters"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "password_encryption"
    value = "scram-sha-256"
  }

  # Statement text can contain PHI, so it is never logged; only errors and
  # durations are (Bible §21.2, spec §7.2).
  parameter {
    name  = "log_statement"
    value = "none"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "-1"
  }
}

data "aws_iam_policy_document" "monitoring_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  name               = "${var.name_prefix}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume.json
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  role       = aws_iam_role.monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "this" {
  # checkov:skip=CKV_AWS_157: multi_az is a variable: dev runs single-AZ on synthetic data; staging and production pass true
  identifier = var.name_prefix

  engine                     = "postgres"
  engine_version             = var.engine_version
  auto_minor_version_upgrade = true
  instance_class             = var.instance_class
  parameter_group_name       = aws_db_parameter_group.this.name
  ca_cert_identifier         = "rds-ca-rsa2048-g1"

  db_name                             = "aestara"
  username                            = "aestara_admin"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = var.data_kms_key_arn
  iam_database_authentication_enabled = true

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.data_kms_key_arn

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  backup_retention_period   = 35
  backup_window             = "07:00-08:00"
  maintenance_window        = "sun:08:30-sun:09:30"
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-final"

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = var.data_kms_key_arn
  performance_insights_retention_period = 7
  monitoring_interval                   = 60
  monitoring_role_arn                   = aws_iam_role.monitoring.arn
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  apply_immediately = false

  tags = { Name = var.name_prefix }
}
