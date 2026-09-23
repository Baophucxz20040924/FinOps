import { z } from "zod";

const ROLE_ARN_RE = /^arn:aws:iam::(\d{12}):role\/[\w+=,.@/-]+$/;
const REGION_RE = /^[a-z]{2}-[a-z]+-\d$/;

export const createAccountSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    awsAccountId: z.string().regex(/^\d{12}$/, "Must be a 12-digit account id"),
    roleArn: z.string().regex(ROLE_ARN_RE, "Must be a valid IAM role ARN"),
    enabledRegions: z
      .array(z.string().regex(REGION_RE, "Invalid region code"))
      .min(1, "At least one region is required"),
  })
  .refine(
    (v) => {
      const match = ROLE_ARN_RE.exec(v.roleArn);
      return match?.[1] === v.awsAccountId;
    },
    {
      message: "roleArn account id must match awsAccountId",
      path: ["roleArn"],
    },
  );

export type CreateAccountBody = z.infer<typeof createAccountSchema>;
