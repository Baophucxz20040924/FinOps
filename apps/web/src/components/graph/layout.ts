import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

const NODE_W = 180;
const NODE_H = 52;

/**
 * Runs a hierarchical (top-down) dagre layout over the nodes/edges and returns
 * the nodes with computed x/y positions. React Flow itself has no layout
 * algorithm, so this assigns positions before rendering.
 */
export function layoutGraph<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
): Node<T>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 70 });

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
    };
  });
}
