import pino, { type Logger } from "pino";

export type { Logger };

const REDACT_PATHS = [
  "*.SecretAccessKey",
  "*.SessionToken",
  "*.AccessKeyId",
  "credentials.SecretAccessKey",
  "credentials.SessionToken",
  "secretAccessKey",
  "sessionToken",
  "password",
  "*.password",
];

export interface LoggerOptions {
  level?: string;
  /** "pretty" for local dev, "json" for production. */
  format?: "pretty" | "json";
  base?: Record<string, unknown>;
}

/**
 * Creates the root structured logger. Credentials and secrets are redacted at
 * the transport level so they can never be logged from any call site.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? process.env.LOG_LEVEL ?? "info";
  const format =
    opts.format ?? (process.env.LOG_FORMAT === "json" ? "json" : "pretty");

  return pino({
    level,
    base: opts.base ?? {},
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    ...(format === "pretty"
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
          },
        }
      : {}),
  });
}

/** A logger bound to a scan's correlation fields, per the observability plan. */
export type ScopedLogger = Logger;
