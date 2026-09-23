import { intEnv, optionalEnv } from "@infra-explorer/shared";

export const APP_CONFIG = Symbol("APP_CONFIG");

export interface AppConfig {
  port: number;
  corsOrigins: string[];
  awsRegion: string;
  /** Worker role ARN target accounts must trust; shown during registration. */
  controlWorkerRoleArn: string;
}

export function loadConfig(): AppConfig {
  return {
    port: intEnv("API_PORT", 4000),
    corsOrigins: optionalEnv("CORS_ORIGINS", "http://localhost:3000")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    awsRegion: optionalEnv("AWS_REGION", "us-east-1"),
    controlWorkerRoleArn: optionalEnv("CONTROL_WORKER_ROLE_ARN", ""),
  };
}
