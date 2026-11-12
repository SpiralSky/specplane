import type { Command } from "commander";
import { prepareDecision, retrieveDecisions, writeDecision, type DecisionOperation, type DecisionView } from "../decisions/decisions.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, guard } from "../perm/permissions.js";
import { withStoreLock } from "../repo/store.js";
import type { Ctx, Result } from "../spec/human.js";
import { specApproveHuman } from "./spec-human.js";
import { runCommand, type CommandResult } from "./runner.js";

/** Human CLI commands for decision records (`feature/later-releases` R37, R37.1; `architecture/reference-cli` §13.1). */

const context = (): Ctx => { const root = checkoutRoot(); return { root, actor: cliActor(root), preset: activePreset(root) }; };

const fromResult = (r: Result): CommandResult =>
  r.request ? { ok: true, held: true, lines: r.lines, data: { request: r.request } } : { ok: r.ok, data: { written: r.written }, findings: r.reasons, lines: r.lines };

const list = (s: string | undefined): string[] | undefined => (s === undefined ? undefined : s.split(",").map((x) => x.trim()).filter(Boolean));
const show = (v: DecisionView): string[] => [
  `${v.id}  ${v.title}`, `date: ${v.date}`, `status: ${v.status}${v.statusReason ? ` (${v.statusReason})` : ""}`,
  ...(v.concerns.length ? [`concerns: ${v.concerns.join(", ")}`] : []), "", `Decision: ${v.decision}`, `Context: ${v.context}`, ...(v.reasons ? [`Reasons: ${v.reasons}`] : []),
];

function read(q: { id?: string; query?: string; concerns?: string }, full: boolean): CommandResult {
  const c = context();
  const g = guard(c.preset, c.actor, ["decision.retrieve"], "Reading decision records");
  if (g.kind !== "allow") return { ok: false, findings: [g.kind === "deny" ? g.message : "Reading decision records needs approval from the user."], permission: "decision.retrieve" };
  const r = retrieveDecisions(c, q);
  const lines = full ? r.records.flatMap((v, i) => [...(i ? [""] : []), ...show(v)])
    : r.records.map((v) => `${v.id}  ${v.date}  ${v.status}  ${v.title}`);
  return { ok: r.ok, data: r.records, findings: [...r.reasons, ...r.problems.map((p) => `${p.file}: ${p.reasons.join("; ")}`)], lines: lines.length ? lines : ["No decision records."], permission: "decision.retrieve" };
}

function write(operation: DecisionOperation, input: Parameters<typeof prepareDecision>[2]): CommandResult {
  const c = context();
  return fromResult(withStoreLock(c.root, "commands", () => writeDecision(c, operation, prepareDecision(c, operation, input))));
}

export function registerDecisionCommands(program: Command): void {
  const d = program.command("decision").description("Work with user decision records (add, list, show, edit, delete, approve)");
  const fields = (c: Command) => c.option("--title <text>", "short title").option("--decision <text>", "what the user decided").option("--context <text>", "the context and reasons the user gave")
    .option("--reasons <text>", "reasons, when given apart from the context").option("--concerns <ids>", "comma separated specification or plan IDs").option("--date <date>", "YYYY-MM-DD, default today").option("--json");
  fields(d.command("add").description("Add a decision record the user made"))
    .action((o) => runCommand({ command: "decision add", args: [], json: o.json }, () => write("add", { title: o.title, decision: o.decision, context: o.context, reasons: o.reasons, concerns: list(o.concerns), date: o.date })));
  d.command("list [query]").description("List decision records, or those matching a description of a topic").option("--concerns <id>", "only records that concern this specification or plan").option("--json")
    .action((query: string | undefined, o) => runCommand({ command: "decision list", args: query ? [query] : [], json: o.json }, () => read({ query, concerns: o.concerns }, false)));
  d.command("show <id>").description("Show one decision record").option("--json")
    .action((id: string, o) => runCommand({ command: "decision show", args: [id], json: o.json }, () => read({ id }, true)));
  fields(d.command("edit <id>").description("Change fields of a decision record"))
    .action((id: string, o) => runCommand({ command: "decision edit", args: [id], json: o.json }, () => write("edit", { id, title: o.title, decision: o.decision, context: o.context, reasons: o.reasons, concerns: list(o.concerns), date: o.date })));
  d.command("delete <id>").description("Delete a decision record").option("--json")
    .action((id: string, o) => runCommand({ command: "decision delete", args: [id], json: o.json }, () => write("delete", { id })));
  d.command("approve <ids...>").description("Approve decision records by ID (committed content only)").option("--json")
    .action((ids: string[], o) => runCommand({ command: "decision approve", args: ids, json: o.json }, () => specApproveHuman(ids, {})));
}
