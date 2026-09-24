import { z } from "zod";

const REGION_RE = /^[a-z]{2}-[a-z]+-\d$/;

export const createScanSchema = z.object({
  accountId: z.string().uuid(),
  /** Optional; defaults to the account's enabledRegions when omitted. */
  regions: z.array(z.string().regex(REGION_RE)).optional(),
});

export type CreateScanBody = z.infer<typeof createScanSchema>;
