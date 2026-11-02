import * as fs from "node:fs";
import { evaluateImplementation, type CompletionSnapshot } from "../core/completion.js";
import { resolveSpecId } from "./resolve.js";
import type { Config } from "../types.js";

export function completionSnapshot(config: Config, root: string): CompletionSnapshot {
  return { resolve(reference, fromRoot) {
    const hit = resolveSpecId(reference, config, fromRoot, root);
    return { id: `${hit.root}:${hit.id}`, content: fs.readFileSync(hit.path, "utf8") };
  } };
}

export function assessFile(id: string, rootName: string, file: string, config: Config, root: string) {
  return evaluateImplementation({ id: `${rootName}:${id}`, content: fs.readFileSync(file, "utf8") }, completionSnapshot(config, root));
}
