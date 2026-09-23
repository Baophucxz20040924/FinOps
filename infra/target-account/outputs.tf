output "role_arn" {
  description = "ARN of the created read-only role. Paste this into the platform when registering the account."
  value       = aws_iam_role.read_only.arn
}

output "role_name" {
  description = "Name of the created read-only role."
  value       = aws_iam_role.read_only.name
}
