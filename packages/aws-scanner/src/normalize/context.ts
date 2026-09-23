/** Identity context a normalizer needs to build ARNs + set the owning account. */
export interface NormalizeContext {
  region: string;
  /** Internal account uuid (Resource.accountId / DB foreign key). */
  accountId: string;
  /** 12-digit AWS account id (used in ARNs). */
  awsAccountId: string;
}

/** Narrows a list of possibly-undefined strings to defined values. */
export function definedStrings(
  values: Array<string | undefined>,
): string[] {
  return values.filter((v): v is string => v !== undefined && v !== "");
}
