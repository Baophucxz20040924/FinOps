import { type PipeTransform } from "@nestjs/common";
import { ValidationError } from "@infra-explorer/shared";
import type { ZodSchema } from "zod";

/**
 * Validates and narrows a request payload against a Zod schema, throwing a
 * client-safe ValidationError (400) with flattened field errors on failure.
 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(
        "Request validation failed",
        result.error.flatten(),
      );
    }
    return result.data;
  }
}
