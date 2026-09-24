import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";

export interface ResourceNodeData extends Record<string, unknown> {
  label: string;
  service: string;
  type: string;
  hasFindings: boolean;
  dimmed: boolean;
}

const SERVICE_COLOR: Record<string, string> = {
  EC2: "border-orange-400",
  EBS: "border-red-400",
  VPC: "border-blue-400",
  RDS: "border-indigo-400",
  ALB: "border-purple-400",
  ECS: "border-teal-400",
  S3: "border-green-400",
  Lambda: "border-amber-400",
  SQS: "border-pink-400",
  CloudFront: "border-cyan-400",
};

export function ResourceNode({
  data,
}: NodeProps & { data: ResourceNodeData }): ReactNode {
  const border = SERVICE_COLOR[data.service] ?? "border-neutral-400";
  return (
    <div
      className={
        "w-[180px] rounded-md border-l-4 bg-white px-3 py-2 shadow-sm dark:bg-neutral-800 " +
        border +
        (data.dimmed ? " opacity-30" : "")
      }
    >
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          {data.service} · {data.type}
        </span>
        {data.hasFindings && (
          <span
            title="Has findings"
            className="h-2 w-2 rounded-full bg-amber-500"
          />
        )}
      </div>
      <div className="truncate text-sm font-medium" title={data.label}>
        {data.label}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-neutral-400"
      />
    </div>
  );
}
