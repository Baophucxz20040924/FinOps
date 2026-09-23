import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createLogger } from "@infra-explorer/shared";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";

async function bootstrap(): Promise<void> {
  const logger = createLogger({ base: { app: "api" } });
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: config.corsOrigins });
  app.enableShutdownHooks();

  await app.listen(config.port);
  logger.info(
    { port: config.port, corsOrigins: config.corsOrigins },
    "API listening",
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start API", err);
  process.exit(1);
});
