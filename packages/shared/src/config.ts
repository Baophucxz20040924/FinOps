import { ValidationError } from "./errors";

/** Reads a required env var, throwing a clear error if missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new ValidationError(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Reads an optional env var with a fallback. */
export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new ValidationError(`Environment variable ${name} must be an integer`);
  }
  return parsed;
}
