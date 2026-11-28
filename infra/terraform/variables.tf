# All set from GitHub variables in CI (TF_VAR_*); none is a secret.

variable "aws_region" {
  description = "Region for the AWS provider's endpoint: the state bucket's region (TF_STATE_REGION)."
  type        = string
  default     = "eu-north-1"
}

variable "cloudflare_account_id" {
  description = "Id of the production Cloudflare account, which holds the flussctrl.com zone (GitHub variable CLOUDFLARE_DNS_ACCOUNT_ID)."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character Cloudflare account id."
  }
}

variable "cloudflare_zone_id" {
  description = "Id of the existing flussctrl.com zone, imported on the first apply (GitHub variable CLOUDFLARE_ZONE_ID)."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id must be a 32-character Cloudflare zone id."
  }
}
