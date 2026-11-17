import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createAjv } from "../ajv.js";
import { storeDir } from "../repo/store.js";

/** Request records in the local store (`architecture/file-formats` §9.2, `architecture/reference-cli` §8). */

export type RequestState = "pending" | "accepted" | "declined" | "cancelled" | "failed";

export interface RequestAnswer { by: string; date: string; note?: string | null; error?: string }

export interface RequestRecord {
  id: string;
  state: RequestState;
  created: string;
  from: { role: string; model?: string | null; session?: string | null };
  /** Every permission the requested action needs; the accepting role must hold each with `allow`. */
  permissions: string[];
  action: { command: string; params: Record<string, unknown> };
  reason: string;
  base: { branch: string | null; commit: string | null };
  diff: string | null;
  plan: string | null;
  /** Execution context; absent only in legacy records. */
  checkout?: string | null;
  blocking: boolean;
  answer: RequestAnswer | null;
}

export class RequestStateError extends Error {
  constructor(message: string) { super(message); this.name = "RequestStateError"; }
}

const dir = (root: string): string => path.join(storeDir(root), "requests");
const file = (root: string, id: string): string => path.join(dir(root), `${id}.json`);
const ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{4}$/;

export function newRequestId(now: Date = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${crypto.randomBytes(2).toString("hex")}`;
}

const text = { type: "string", minLength: 1 };
const nullableText = { anyOf: [text, { type: "null" }] };
const date = { anyOf: [{ type: "string", format: "date-time" }, { type: "string", format: "date" }] };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const schema = object({
  id: { type: "string", pattern: ID_RE.source },
  state: { enum: ["pending", "accepted", "declined", "cancelled", "failed"] },
  created: { type: "string", format: "date-time" },
  from: object({ role: text, model: nullableText, session: nullableText }, ["role"]),
  permissions: { type: "array", items: text, uniqueItems: true },
  action: object({ command: text, params: { type: "object" } }),
  reason: text,
  base: object({ branch: nullableText, commit: { anyOf: [{ type: "string", pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }, { type: "null" }] } }),
  diff: { type: ["string", "null"] },
  plan: { anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}-[a-z0-9]+(?:-[a-z0-9]+){1,3}$", maxLength: 64 }, { type: "null" }] },
  checkout: { anyOf: [{ type: "string", format: "absolute-path" }, { type: "null" }] },
  blocking: { type: "boolean" },
  answer: { anyOf: [object({ by: text, date, note: { type: ["string", "null"] }, error: text }, ["by", "date"]), { type: "null" }] },
}, ["id", "state", "created", "from", "permissions", "action", "reason", "base", "diff", "plan", "blocking", "answer"]);
const ajv = createAjv();
ajv.addFormat("absolute-path", (v: string) => !v.includes("\u0000") && (path.isAbsolute(v) || path.win32.isAbsolute(v)));
const validate = ajv.compile({ ...schema, allOf: [
  { if: { properties: { state: { const: "pending" } } }, then: { properties: { answer: { type: "null" } } }, else: { properties: { answer: { type: "object" } } } },
  { if: { properties: { state: { const: "failed" } } }, then: { properties: { answer: { type: "object", required: ["error"], properties: { error: text } } } } },
  { if: { properties: { blocking: { const: true } } }, then: { properties: { plan: { type: "string" } } } },
  { if: { properties: { checkout: { type: "string" } }, required: ["checkout"] }, then: { properties: { plan: { type: "string" } } } },
] });

/** Legacy records without checkout stay visible; plan context is resolved conservatively on acceptance. */
export function validateRecord(v: unknown): string[] {
  if (validate(v)) return [];
  return [...new Set((validate.errors ?? []).map((e) => e.instancePath.split("/")[1] || (e.params.missingProperty as string) || "record"))];
}

function writeFile(root: string, rec: RequestRecord): void {
  fs.mkdirSync(dir(root), { recursive: true });
  const abs = file(root, rec.id);
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n");
  fs.renameSync(tmp, abs);
}

export function saveNew(root: string, rec: RequestRecord): void {
  const bad = validateRecord(rec);
  if (bad.length) throw new RequestStateError(`invalid request record: ${bad.join(", ")}`);
  writeFile(root, rec);
}

export function readRequest(root: string, id: string): RequestRecord | null {
  if (!ID_RE.test(id)) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(file(root, id), "utf8")) as RequestRecord;
    return validateRecord(rec).length || rec.id !== id ? null : rec;
  } catch { return null; }
}

/** All requests: pending first (oldest first), then answered (newest first). */
export function listRequests(root: string): RequestRecord[] {
  let names: string[] = [];
  try { names = fs.readdirSync(dir(root)).filter((n) => n.endsWith(".json")); } catch { return []; }
  const all = names.map((n) => readRequest(root, n.slice(0, -5))).filter((r): r is RequestRecord => r !== null);
  const pending = all.filter((r) => r.state === "pending").sort((a, b) => a.id.localeCompare(b.id));
  const done = all.filter((r) => r.state !== "pending").sort((a, b) => b.id.localeCompare(a.id));
  return [...pending, ...done];
}

/**
 * Compare-and-set on the state: take a lock file, re-read, require `pending`, write the new state. Two writers cannot
 * both answer one request (`reference-cli` §8).
 */
export function answerRequest(root: string, id: string, state: Exclude<RequestState, "pending">, answer: RequestAnswer): RequestRecord {
  const claim = claimAnswer(root, id);
  try { return claim.answer(state, answer); }
  finally { claim.release(); }
}

export interface AnswerClaim {
  /** Snapshot re-read while holding the answer lock. */
  record: RequestRecord;
  answer(state: Exclude<RequestState, "pending">, answer: RequestAnswer): RequestRecord;
  release(): void;
}

/** A lock older than this with no owner process recorded is taken as left behind by a killed command. */
const STALE_LOCK_MS = 5 * 60 * 1000;

/** True when the lock file's owner is gone: its recorded process no longer exists, or (no pid recorded) it is old. */
function lockIsStale(lock: string): boolean {
  try {
    const pid = Number(fs.readFileSync(lock, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === "ESRCH"; }
    }
    return Date.now() - fs.statSync(lock).mtimeMs > STALE_LOCK_MS;
  } catch { return false; }
}

/** Create the lock exclusively and record this process in it; a lock left by a dead process is removed once and retaken. */
function openLock(lock: string): number {
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = fs.openSync(lock, "wx");
      try { fs.writeSync(fd, String(process.pid)); } catch { /* the pid is only a hint for stale detection */ }
      return fd;
    } catch (e) {
      if (attempt > 0 || (e as NodeJS.ErrnoException).code !== "EEXIST" || !lockIsStale(lock)) throw e;
      fs.rmSync(lock, { force: true });
    }
  }
}

/**
 * Hold the same lock as a direct answer for the entire action and finalization. Callers must release in finally,
 * including when an action throws. Finalization uses this claim, rather than reacquiring the lock.
 */
export function claimAnswer(root: string, id: string): AnswerClaim {
  fs.mkdirSync(dir(root), { recursive: true });
  const lock = `${file(root, id)}.lock`;
  let fd: number;
  try { fd = openLock(lock); } catch { throw new RequestStateError(`Request \`${id}\` is being answered by another command.`); }
  let released = false;
  let answered = false;
  const release = (): void => {
    if (released) return;
    released = true;
    try { fs.closeSync(fd); }
    finally { fs.rmSync(lock, { force: true }); }
  };
  try {
    const rec = readRequest(root, id);
    if (!rec) throw new RequestStateError(`Request \`${id}\` not found.`);
    if (rec.state !== "pending") throw new RequestStateError(`Request \`${id}\` is already ${rec.state}.`);
    return {
      record: rec,
      answer(state, answer) {
        if (released) throw new RequestStateError(`Request \`${id}\` answer claim was released.`);
        if (answered) throw new RequestStateError(`Request \`${id}\` was already answered by this claim.`);
        const next = { ...rec, state, answer };
        const bad = validateRecord(next);
        if (bad.length) throw new RequestStateError(`invalid request answer: ${bad.join(", ")}`);
        writeFile(root, next);
        answered = true;
        return next;
      },
      release,
    };
  } catch (e) {
    release();
    throw e;
  }
}
