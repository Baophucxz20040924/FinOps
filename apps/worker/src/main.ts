import { createLogger } from "@infra-explorer/shared";

/**
 * Worker entrypoint. For now it just boots and idles; later phases wire in the
 * pg-boss consumer and the scan orchestrator (discover -> normalize -> relate
 * -> metrics -> rules -> cost -> persist).
 */
async function main(): Promise<void> {
  const logger = createLogger({ base: { app: "worker" } });
  logger.info("Worker started (idle — scan pipeline not yet wired)");

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "Worker shutting down");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Worker failed to start", err);
  process.exit(1);
});
