/**
 * Regions are configuration, not a persisted entity. We track the set of AWS
 * regions the platform knows how to scan, and each account stores its own
 * enabledRegions subset.
 */

export interface RegionInfo {
  code: string;
  displayName: string;
}

/** Commonly-used commercial regions. Extend as needed. */
export const KNOWN_REGIONS: RegionInfo[] = [
  { code: "us-east-1", displayName: "US East (N. Virginia)" },
  { code: "us-east-2", displayName: "US East (Ohio)" },
  { code: "us-west-1", displayName: "US West (N. California)" },
  { code: "us-west-2", displayName: "US West (Oregon)" },
  { code: "eu-west-1", displayName: "Europe (Ireland)" },
  { code: "eu-central-1", displayName: "Europe (Frankfurt)" },
  { code: "ap-southeast-1", displayName: "Asia Pacific (Singapore)" },
  { code: "ap-southeast-2", displayName: "Asia Pacific (Sydney)" },
  { code: "ap-northeast-1", displayName: "Asia Pacific (Tokyo)" },
  { code: "ap-south-1", displayName: "Asia Pacific (Mumbai)" },
];

const KNOWN_REGION_CODES = new Set(KNOWN_REGIONS.map((r) => r.code));

/** Loose validation for a region code shape (does not require it be known). */
export function isRegionCodeShape(value: string): boolean {
  return /^[a-z]{2}-[a-z]+-\d$/.test(value);
}

export function isKnownRegion(code: string): boolean {
  return KNOWN_REGION_CODES.has(code);
}
