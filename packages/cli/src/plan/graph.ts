/** Plan dependency graph (`architecture/reference-cli` § Dependency graph). */

/** Adjacency list: plan ID -> IDs it depends on. */
export type DirectedGraph = Map<string, string[]>;

export interface GraphNode {
  id: string;
  depends_on?: string[];
}

export function buildGraph(plans: Iterable<GraphNode>): DirectedGraph {
  const g: DirectedGraph = new Map();
  for (const p of plans) g.set(p.id, [...(p.depends_on ?? [])]);
  return g;
}

/**
 * Depth-first search with three-colour marking. Returns the cycle as a path whose first and last
 * entries are equal (for example `a, b, a`), or null. Edges to unknown nodes are ignored.
 */
export function detectCycle(graph: DirectedGraph): string[] | null {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>();
  const parent = new Map<string, string>();
  const visit = (start: string): string[] | null => {
    // Iterative DFS to avoid recursion limits.
    const stack: Array<{ node: string; i: number }> = [{ node: start, i: 0 }];
    colour.set(start, GREY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const next = (graph.get(top.node) ?? [])[top.i++];
      if (next === undefined) {
        colour.set(top.node, BLACK);
        stack.pop();
        continue;
      }
      if (!graph.has(next)) continue;
      const c = colour.get(next) ?? WHITE;
      if (c === GREY) {
        const path = [next];
        for (let n = top.node; n !== next; n = parent.get(n)!) path.push(n);
        path.push(next);
        return path.reverse();
      }
      if (c === WHITE) {
        parent.set(next, top.node);
        colour.set(next, GREY);
        stack.push({ node: next, i: 0 });
      }
    }
    return null;
  };
  for (const id of [...graph.keys()].sort()) {
    if ((colour.get(id) ?? WHITE) === WHITE) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
  }
  return null;
}
