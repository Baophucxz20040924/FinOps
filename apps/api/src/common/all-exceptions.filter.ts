import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { AppError, createLogger } from "@infra-explorer/shared";
import type { Request, Response } from "express";

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Maps thrown errors to a consistent JSON envelope. Our typed AppErrors carry a
 * status + code; NestJS HttpExceptions are passed through; anything else becomes
 * a generic 500 so internal details never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = createLogger({ base: { app: "api" } });

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(
        { err: exception, path: req.url, method: req.method },
        "Unhandled error",
      );
    } else {
      this.logger.warn(
        { code: body.code, path: req.url, method: req.method },
        body.message,
      );
    }

    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof AppError) {
      return {
        statusCode: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === "string"
          ? response
          : ((response as { message?: string }).message ??
            exception.message);
      return { statusCode: status, code: "HTTP_ERROR", message };
    }
    return {
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    };
  }
}
