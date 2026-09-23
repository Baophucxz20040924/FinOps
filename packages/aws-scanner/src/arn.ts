/** Builds an EC2/EBS-style ARN (instances, volumes, subnets, SGs, etc.). */
export function ec2Arn(
  region: string,
  accountId: string,
  resource: string,
): string {
  return `arn:aws:ec2:${region}:${accountId}:${resource}`;
}
