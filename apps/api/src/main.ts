import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { intEnv, optionalEnv, createLogger } from "@infra-explorer/shared";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const logger = createLogger({ base: { app: "api" } });
  const app = await NestFactory.create(AppModule, { logger: false });

  app.setGlobalPrefix("api/v1");

  const corsOrigins = optionalEnv("CORS_ORIGINS", "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins });

  const port = intEnv("API_PORT", 4000);
  await app.listen(port);
  logger.info({ port, corsOrigins }, "API listening");
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start API", err);
  process.exit(1);
});
