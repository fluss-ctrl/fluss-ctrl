# DNS for flussctrl.com (SPEC §16, §21.3): the primary zone in the production Cloudflare account and
# a pre-provisioned Route 53 secondary in the AWS DNS account. Applied only from CI after the
# production Environment approval (.github/workflows/terraform.yml); never from a laptop or a
# session. Runbook: docs/runbooks/dns-switch.md.
terraform {
  required_version = "~> 1.17.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.29"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.74"
    }
  }

  # State lives in the S3 bucket in the AWS DNS account. Bucket and region come from the GitHub
  # variables TF_STATE_BUCKET and TF_STATE_REGION through `-backend-config` in CI, so no account
  # detail is committed. S3-native locking (no DynamoDB table).
  backend "s3" {
    key          = "dns/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment: the DNS token, read-only in the preview
# Environment (plan) and read/write in production (apply).
provider "cloudflare" {}

# Route 53 is a global service. The region only sets the endpoint for the provider's other calls;
# the organisation's SCP allows regional services in eu-north-1 only.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      project    = "fluss-ctrl"
      managed-by = "terraform"
      source     = "infra/terraform"
    }
  }
}
