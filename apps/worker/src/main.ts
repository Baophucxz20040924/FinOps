import PgBoss from "pg-boss";
import { createDb, closeDb } from "@infra-explorer/db";
import {
  createLogger,
  loadDotenv,
  requireEnv,
  optionalEnv,
  SCAN_QUEUE,
  type ScanJob,
} from "@infra-explorer/shared";
import { ScanOrchestrator } from "./orchestrator";

/**
 * Worker entrypoint: consumes scan jobs from pg-boss (Postgres-native queue)
 * and runs the scan pipeline for each. Long-running; one shared DB pool.
 */
async function main(): Promise<void> {
  // Load .env before anything reads config or AWS credentials (AWS_PROFILE, etc.).
  const envPath = loadDotenv();
  const logger = createLogger({ base: { app: "worker" } });
  if (envPath) logger.info({ envPath }, "Loaded .env");
  const connectionString = requireEnv("DATABASE_URL");
  const awsRegion = optionalEnv("AWS_REGION", "us-east-1");

  const { db, pool } = createDb({ connectionString });
  const orchestrator = new ScanOrchestrator({ db, logger, awsRegion });

  const boss = new PgBoss(connectionString);
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();
  await boss.createQueue(SCAN_QUEUE);

  await boss.work<ScanJob>(SCAN_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const { scanId } = job.data;
      logger.info({ scanId }, "Picked up scan job");
      try {
        await orchestrator.run(scanId);
      } catch (err) {
        logger.error({ err, scanId }, "Scan job failed");
        throw err; // let pg-boss record the failure / retry per policy
      }
    }
  });

  logger.info({ queue: SCAN_QUEUE }, "Worker ready — waiting for scan jobs");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Worker shutting down");
    await boss.stop();
    await closeDb(pool);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Worker failed to start", err);
  process.exit(1);
});
