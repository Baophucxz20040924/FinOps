# Trust policy: only the platform's worker role may assume this role, and only
# when it presents the matching ExternalId (confused-deputy mitigation).
data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [var.control_account_principal_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [var.external_id]
    }
  }
}

# Least-privilege READ-ONLY policy. Only Describe/List/Get verbs on the services
# the MVP scanner touches, plus CloudWatch metric reads and Cost Explorer.
# No mutating actions are granted anywhere.
data "aws_iam_policy_document" "read_only" {
  statement {
    sid    = "ComputeAndNetworkRead"
    effect = "Allow"
    actions = [
      "ec2:Describe*",
      "autoscaling:Describe*",
      "elasticloadbalancing:Describe*",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "DatabaseRead"
    effect = "Allow"
    actions = [
      "rds:Describe*",
      "rds:ListTagsForResource",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "ContainerRead"
    effect = "Allow"
    actions = [
      "ecs:List*",
      "ecs:Describe*",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "ServerlessRead"
    effect = "Allow"
    actions = [
      "lambda:List*",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "IntegrationRead"
    effect = "Allow"
    actions = [
      "sqs:ListQueues",
      "sqs:ListQueueTags",
      "sqs:GetQueueAttributes",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "StorageRead"
    effect = "Allow"
    actions = [
      "s3:ListAllMyBuckets",
      "s3:GetBucketLocation",
      "s3:GetBucketTagging",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "EdgeRead"
    effect = "Allow"
    actions = [
      "cloudfront:List*",
      "cloudfront:GetDistribution",
      "cloudfront:GetDistributionConfig",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "MetricsRead"
    effect = "Allow"
    actions = [
      "cloudwatch:GetMetricData",
      "cloudwatch:ListMetrics",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "CostExplorerRead"
    effect = "Allow"
    actions = [
      "ce:GetCostAndUsage",
      "ce:GetCostForecast",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "TaggingRead"
    effect = "Allow"
    actions = [
      "tag:GetResources",
      "tag:GetTagKeys",
      "tag:GetTagValues",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role" "read_only" {
  name                 = var.role_name
  assume_role_policy   = data.aws_iam_policy_document.assume_role.json
  max_session_duration = var.max_session_duration
  description          = "Read-only role assumed by AWS Infrastructure Explorer."
  tags                 = var.tags
}

resource "aws_iam_role_policy" "read_only" {
  name   = "${var.role_name}-policy"
  role   = aws_iam_role.read_only.id
  policy = data.aws_iam_policy_document.read_only.json
}
