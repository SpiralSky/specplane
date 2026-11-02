import type { DirectedGraph } from "../plan/graph.js";
import type { IndexStatus } from "../plan/status.js";

const CLASS_DEFS = [
  "draft fill:#f9fafb,color:#374151,stroke:#d1d5db",
  "ready fill:#22c55e,color:#fff",
  "blocked fill:#ef4444,color:#fff",
  "in_progress fill:#3b82f6,color:#fff",
  "review fill:#60a5fa,color:#fff",
  "done fill:#9ca3af,color:#fff",
  "abandoned fill:#9ca3af,color:#fff,text-decoration:line-through",
  "shelved fill:#fef3c7,color:#92400e,stroke:#d97706",
];

export function nodeKey(id: string): string {
  return "p_" + id.replace(/-/g, "_");
}

/** Plan slug: the ID without its `YYYY-MM-DD-` prefix. */
export function slugOf(id: string): string {
  return id.replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

/** Mermaid graph per `architecture/file-formats` §5.2 (without the code fence). */
export function toMermaid(graph: DirectedGraph, statuses: Map<string, IndexStatus>): string {
  const lines = ["graph TD"];
  const ids = [...graph.keys()].sort();
  for (const id of ids) {
    lines.push(`    ${nodeKey(id)}[${slugOf(id)}]:::${statuses.get(id) ?? "draft"}`);
  }
  for (const id of ids) {
    for (const dep of [...(graph.get(id) ?? [])].sort()) {
      if (graph.has(dep)) lines.push(`    ${nodeKey(dep)} --> ${nodeKey(id)}`);
    }
  }
  for (const c of CLASS_DEFS) lines.push(`    classDef ${c}`);
  return lines.join("\n");
}
