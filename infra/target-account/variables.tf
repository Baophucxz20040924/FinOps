variable "aws_region" {
  description = "Region to configure the AWS provider with (IAM is global; any valid region works)."
  type        = string
  default     = "us-east-1"
}

variable "role_name" {
  description = "Name of the read-only role the platform will assume."
  type        = string
  default     = "InfraExplorerReadOnly"
}

variable "control_account_principal_arn" {
  description = <<-EOT
    ARN of the platform's worker role in the control account that is allowed to
    assume this role, e.g.
    "arn:aws:iam::<CONTROL_ACCOUNT_ID>:role/InfraExplorerWorkerRole".
  EOT
  type        = string

  validation {
    condition     = can(regex("^arn:aws:iam::\\d{12}:role/.+$", var.control_account_principal_arn))
    error_message = "control_account_principal_arn must be a valid IAM role ARN."
  }
}

variable "external_id" {
  description = <<-EOT
    ExternalId that the platform generated for this account. REQUIRED — mitigates
    the confused-deputy problem. Copy it from the account's registration screen.
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.external_id) >= 8
    error_message = "external_id must be at least 8 characters."
  }
}

variable "max_session_duration" {
  description = "Max STS session duration (seconds) for the assumed role."
  type        = number
  default     = 3600
}

variable "tags" {
  description = "Tags applied to the created IAM role."
  type        = map(string)
  default     = {}
}
