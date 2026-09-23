/**
 * Typed application errors. HTTP layers map `.status` onto responses; nothing
 * here leaks raw AWS SDK internals to clients.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    opts: { status?: number; code?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status ?? 500;
    this.code = opts.code ?? "INTERNAL_ERROR";
    this.details = opts.details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { status: 400, code: "VALIDATION_ERROR", details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, { status: 404, code: "NOT_FOUND" });
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, { status: 409, code: "CONFLICT" });
  }
}

/** Raised when assuming a target account's role fails. Message is client-safe. */
export class AwsAccessError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { status: 400, code: "AWS_ACCESS_ERROR", details });
  }
}
