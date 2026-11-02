import { evaluateImplementation, type CompletionSnapshot } from "../core/completion.js";
import { resolveSpecId } from "./resolve.js";
import type { Config } from "../types.js";

export function completionSnapshot(config: Config, root: string, contents: ReadonlyMap<string, string>): CompletionSnapshot {
  return { resolve(reference, fromRoot) {
    const hit = resolveSpecId(reference, config, fromRoot, root, file => contents.has(file));
    return { id: `${hit.root}:${hit.id}`, content: contents.get(hit.path)! };
  } };
}

export function assessContent(id: string, rootName: string, content: string, snapshot: CompletionSnapshot) {
  return evaluateImplementation({ id: `${rootName}:${id}`, content }, snapshot);
}
