import type { IsoTimestamp } from "./common";

export type MetricStatistic = "avg" | "max" | "sum" | "min";

/**
 * A pre-aggregated utilization datapoint (e.g. one daily rollup), NOT a raw
 * CloudWatch datapoint. Keeps growth linear in resource x days, not x1440.
 */
export interface Metric {
  id: string;
  resourceId: string;
  /** e.g. "CPUUtilization", "NetworkIn", "RequestCount". */
  metricName: string;
  statistic: MetricStatistic;
  windowStart: IsoTimestamp;
  windowEnd: IsoTimestamp;
  value: number;
  collectedAt: IsoTimestamp;
}

/** Rolled-up summary of a metric over a lookback window, used by rules. */
export interface MetricSummary {
  metricName: string;
  statistic: MetricStatistic;
  /** Aggregate value over the whole window. */
  value: number;
  /** Number of daily datapoints actually available (drives confidence). */
  datapointCount: number;
  windowStart: IsoTimestamp;
  windowEnd: IsoTimestamp;
}
