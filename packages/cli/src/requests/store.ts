import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { storeDir } from "../repo/store.js";

/** Request records in the local store (`architecture/file-formats` §9.2, `architecture/reference-cli` §8). */

export type RequestState = "pending" | "accepted" | "declined" | "failed";

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

/** Structural validation of a record read from disk; returns the problems found. */
export function validateRecord(v: unknown): string[] {
  const bad: string[] = [];
  const r = v as Partial<RequestRecord> | null;
  if (!r || typeof r !== "object") return ["not an object"];
  if (typeof r.id !== "string" || !ID_RE.test(r.id)) bad.push("id");
  if (!["pending", "accepted", "declined", "failed"].includes(r.state as string)) bad.push("state");
  if (typeof r.created !== "string") bad.push("created");
  if (!r.from || typeof r.from.role !== "string") bad.push("from");
  if (!Array.isArray(r.permissions) || r.permissions.some((p) => typeof p !== "string")) bad.push("permissions");
  if (!r.action || typeof r.action.command !== "string" || typeof r.action.params !== "object" || r.action.params === null) bad.push("action");
  if (typeof r.reason !== "string") bad.push("reason");
  if (typeof r.blocking !== "boolean") bad.push("blocking");
  return bad;
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
  try {
    const rec = JSON.parse(fs.readFileSync(file(root, id), "utf8")) as RequestRecord;
    return validateRecord(rec).length ? null : rec;
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

/**
 * Hold the same lock as a direct answer for the entire action and finalization. Callers must release in finally,
 * including when an action throws. Finalization uses this claim, rather than reacquiring the lock.
 */
export function claimAnswer(root: string, id: string): AnswerClaim {
  fs.mkdirSync(dir(root), { recursive: true });
  const lock = `${file(root, id)}.lock`;
  let fd: number;
  try { fd = fs.openSync(lock, "wx"); } catch { throw new RequestStateError(`Request \`${id}\` is being answered by another command.`); }
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
