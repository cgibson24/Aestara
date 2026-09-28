# tflint: Terraform language rules plus the AWS ruleset (invalid instance
# types, deprecated arguments, missing tags…). CI: `tflint --init` then
# `tflint --recursive --config "$PWD/.tflint.hcl"`.
config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.49.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
