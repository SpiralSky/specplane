import { collector, type Rule } from "./types.js";

/** Configuration findings from reading `.specplane/config.yaml` at HEAD (`architecture/reference-cli` §3.2). */
export const rules: Rule[] = [{
  id: "config",
  severity: "error",
  source: "committed",
  run(ctx) {
    const { emit, items } = collector();
    for (const c of ctx.config) emit(c.severity, "config", c.message, ".specplane/config.yaml");
    return items;
  },
}];
