import type { ResourceScanner } from "./types";
import { Ec2Scanner } from "./scanners/ec2.scanner";
import { EbsScanner } from "./scanners/ebs.scanner";
import { VpcScanner } from "./scanners/vpc.scanner";

/**
 * The scanners run for an MVP scan, in a sensible order (networking first so
 * downstream relationship targets exist). Each carries its own REGIONAL/GLOBAL
 * scope, which the orchestrator uses to decide per-region vs once-per-scan.
 */
export function defaultScanners(): ResourceScanner[] {
  return [new VpcScanner(), new Ec2Scanner(), new EbsScanner()];
}
