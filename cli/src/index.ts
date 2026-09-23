#!/usr/bin/env node
import { Command } from "commander";

/**
 * infra-explorer CLI. This is a thin client over the REST API (per the plan),
 * NOT a second scanner implementation. Commands are stubbed for now and wired
 * to the API in a later phase.
 */
const program = new Command();

program
  .name("infra-explorer")
  .description("AWS Infrastructure Explorer CLI")
  .version("0.0.0");

program
  .command("accounts")
  .description("Manage registered AWS accounts")
  .action(() => {
    // eslint-disable-next-line no-console
    console.log("accounts: not yet implemented");
  });

program
  .command("scan")
  .description("Trigger a scan against a registered account")
  .action(() => {
    // eslint-disable-next-line no-console
    console.log("scan: not yet implemented");
  });

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
