"use client";

import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, type ReactNode } from "react";
import type { Graph } from "@infra-explorer/domain";
import { layoutGraph } from "./layout";
import { ResourceNode, type ResourceNodeData } from "./ResourceNode";

const nodeTypes = { resource: ResourceNode };

export function InfraGraph({
  graph,
  search,
  onSelect,
}: {
  graph: Graph;
  search: string;
  onSelect: (id: string) => void;
}): ReactNode {
  const { nodes, edges } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rawNodes: Node<ResourceNodeData>[] = graph.nodes.map((n) => ({
      id: n.id,
      type: "resource",
      position: { x: 0, y: 0 },
      data: {
        label: n.name ?? n.type,
        service: n.service,
        type: n.type,
        hasFindings: n.hasFindings,
        dimmed:
          q.length > 0 &&
          !(n.name ?? "").toLowerCase().includes(q) &&
          !n.service.toLowerCase().includes(q) &&
          !n.type.toLowerCase().includes(q),
      },
    }));
    const rawEdges: Edge[] = graph.edges.map((e, i) => ({
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      label: e.type,
      animated: false,
      style:
        e.confidence === "INFERRED"
          ? { strokeDasharray: "4 4" }
          : undefined,
    }));
    return { nodes: layoutGraph(rawNodes, rawEdges), edges: rawEdges };
  }, [graph, search]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
