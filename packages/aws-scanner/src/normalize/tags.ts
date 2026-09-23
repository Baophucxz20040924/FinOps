import type { Tags } from "@infra-explorer/domain";

/** An AWS-style tag as returned by most EC2/ELB/RDS APIs. */
export interface AwsTag {
  Key?: string;
  Value?: string;
}

/** Converts an AWS tag list into a plain record, dropping malformed entries. */
export function tagListToRecord(tags: AwsTag[] | undefined): Tags {
  const record: Tags = {};
  for (const tag of tags ?? []) {
    if (tag.Key !== undefined && tag.Value !== undefined) {
      record[tag.Key] = tag.Value;
    }
  }
  return record;
}

/** Derives a display name from tags, falling back to the native id. */
export function deriveName(tags: Tags, fallback: string): string {
  return tags.Name ?? tags.name ?? fallback;
}

const ENV_TAG_KEYS = [
  "Environment",
  "environment",
  "env",
  "Env",
  "ENV",
  "stage",
  "Stage",
  "STAGE",
];

/** Best-effort environment extraction from common tag conventions. */
export function deriveEnvironment(tags: Tags): string | null {
  for (const key of ENV_TAG_KEYS) {
    const value = tags[key];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return null;
}
