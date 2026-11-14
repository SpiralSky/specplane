import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createActionRuntime, listActions } from "./actions.js";
import { actionOfTool, listTools, replyText } from "./mcp.js";
import { removeStoreJson, writeStoreJson } from "../repo/store.js";

/**
 * The session server (`architecture/reference-cli` §12.8): the second action channel. A harness mod starts it once per
 * session and forwards each tool call over a Unix socket. Every request carries the per-session secret in `SECRET_HEADER`;
 * the actor is an LLM built from the caller object of the request, the model and the session, never from the input.
 * Requests are answered within `answerLimitMs` (25 seconds): a longer action answers `pending` and is fetched with `/poll`.
 */
export const SECRET_HEADER = "x-specplane-secret";
export const ANSWER_LIMIT_MS = 25_000;
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const JOB_KEEP_MS = 10 * 60 * 1000;
export const PARENT_CHECK_MS = 2000;
export const MAX_SOCKET_PATH_BYTES = 100;
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface SessionServerOptions {
  session: string;
  root: string;
  parentPid: number;
  /** Default: chosen by the core (`socketDirectory`, a name hashed from the session ID); tests may fix it. */
  socketPath?: string;
  answerLimitMs?: number;
  parentCheckMs?: number;
  jobKeepMs?: number;
  /** The running host version and the one the plugin was checked against; the match is recorded for the adapter. */
  hostVersion?: string;
  checkedVersion?: string;
}

export interface ReadyInfo {
  socket: string;
  secret: string;
  pid: number;
  actions: { name: string; description: string; inputSchema: unknown }[];
}

export interface SessionServer {
  ready: ReadyInfo;
  /** Stop accepting requests, finish running calls, remove the socket. */
  stop(): Promise<void>;
  /** Resolves when the server has stopped for any reason (shutdown request, parent gone, `stop`). */
  closed: Promise<void>;
}

/** `$XDG_RUNTIME_DIR/specplane`, else a per-user directory under the system temporary directory; created or checked as 0700 and owned by the user. */
export function socketDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const uid = process.getuid?.();
  const base = env.XDG_RUNTIME_DIR?.trim();
  const dir = base ? path.join(base, "specplane") : path.join(os.tmpdir(), `specplane-${uid ?? os.userInfo().username}`);
  ensurePrivateDirectory(dir);
  return dir;
}

export function ensurePrivateDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  const uid = process.getuid?.();
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`The socket directory ${dir} is not a plain directory.`);
  if (uid !== undefined && st.uid !== uid) throw new Error(`The socket directory ${dir} is not owned by the current user.`);
  if (process.platform !== "win32" && (st.mode & 0o077) !== 0) throw new Error(`The socket directory ${dir} must be accessible only by its owner (mode 0700), it has ${(st.mode & 0o777).toString(8)}.`);
}

/** True when something answers on the socket path. */
function answers(socket: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(socket);
    c.once("connect", () => { c.destroy(); resolve(true); });
    c.once("error", () => resolve(false));
  });
}

const clean = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface Job { promise: Promise<Done>; result?: Done; expiry?: NodeJS.Timeout }
interface Done { status: "done"; text: string; isError: boolean }
const sleep = (ms: number): Promise<"timeout"> => new Promise((r) => { setTimeout(() => r("timeout"), ms).unref?.(); });

export async function startSessionServer(options: SessionServerOptions): Promise<SessionServer> {
  if (!SESSION_ID.test(options.session) || options.session === "." || options.session === "..") throw new Error("The session ID must be 1 to 128 letters, digits, dots, hyphens or underscores.");
  const socketPath = options.socketPath ?? path.join(socketDirectory(), `s-${createHash("sha256").update(options.session).digest("hex").slice(0, 16)}.sock`);
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) throw new Error(`The socket path ${socketPath} is longer than ${MAX_SOCKET_PATH_BYTES} bytes; set a shorter XDG_RUNTIME_DIR or TMPDIR.`);
  if (options.socketPath) ensurePrivateDirectory(path.dirname(socketPath));
  // Sweep once: other sockets of this naming that nothing answers on are leftovers of killed servers.
  if (!options.socketPath) {
    for (const f of fs.readdirSync(path.dirname(socketPath))) {
      const other = path.join(path.dirname(socketPath), f);
      if (other !== socketPath && /^s-[0-9a-f]{16}\.sock$/.test(f) && !(await answers(other))) fs.rmSync(other, { force: true });
    }
  }
  if (fs.existsSync(socketPath)) {
    if (await answers(socketPath)) throw new Error(`Another process answers on ${socketPath}; it is not removed.`);
    fs.rmSync(socketPath, { force: true });
  }

  const limit = options.answerLimitMs ?? ANSWER_LIMIT_MS;
  const keep = options.jobKeepMs ?? JOB_KEEP_MS;
  const secret = randomBytes(32).toString("hex");
  const secretBuffer = Buffer.from(secret);
  const launcher = (await import("./adapter-claude.js")).claudeLauncher;
  const runtime = createActionRuntime({ root: options.root, id: options.session, reportsContext: true, provider: "anthropic", adapter: "claude", launcher });
  const jobs = new Map<string, Job>();
  const running = new Set<Promise<unknown>>();
  let stopping: Promise<void> | undefined;
  let jobCounter = 0;

  const startJob = (action: string, input: unknown, caller: { agentId?: string; agentType?: string }, model: string | undefined): [string, Job] => {
    const id = `j${++jobCounter}-${randomBytes(6).toString("hex")}`;
    const job: Job = { promise: undefined as unknown as Promise<Done> };
    job.promise = runtime.call(action, input, caller, model).then(
      (reply): Done => ({ status: "done", text: replyText(reply), isError: !reply.ok }),
      (e): Done => ({ status: "done", text: JSON.stringify({ ok: false, findings: [e instanceof Error ? e.message : String(e)], instructions: [] }), isError: true }),
    ).then((r) => { job.result = r; if (jobs.has(id)) { job.expiry = setTimeout(() => jobs.delete(id), keep); job.expiry.unref(); } return r; });
    running.add(job.promise);
    void job.promise.finally(() => running.delete(job.promise));
    jobs.set(id, job);
    return [id, job];
  };
  /** Answer with the result when the job ends within the limit, else `pending`; a delivered result is dropped. */
  const answerJob = async (id: string, job: Job): Promise<unknown> => {
    const r = await Promise.race([job.promise, sleep(limit)]);
    if (r === "timeout") return { status: "pending", job: id };
    if (job.expiry) clearTimeout(job.expiry);
    jobs.delete(id);
    return r;
  };

  const authorised = (req: http.IncomingMessage): boolean => {
    const given = req.headers[SECRET_HEADER];
    if (typeof given !== "string") return false;
    const g = Buffer.from(given);
    return g.length === secretBuffer.length && timingSafeEqual(g, secretBuffer);
  };
  const send = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: http.IncomingMessage): Promise<unknown> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("The request body is over 4 MiB."), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(Object.assign(new Error("The request body is not JSON."), { status: 400 })); } });
    req.on("error", reject);
  });

  const server = http.createServer(async (req, res) => {
    try {
      if (!authorised(req)) { send(res, 401, { error: "A request needs the session secret." }); req.resume(); return; }
      if (req.method !== "POST" || !["/call", "/poll", "/shutdown"].includes(req.url ?? "")) { send(res, 404, { error: "Unknown route." }); return; }
      if (stopping && req.url !== "/shutdown") { send(res, 503, { error: "The server is shutting down." }); return; }
      const body = await readBody(req);
      const b = isObject(body) ? body : {};
      if (req.url === "/shutdown") {
        res.on("finish", () => void stop());
        send(res, 200, { ok: true });
        return;
      }
      if (req.url === "/poll") {
        const id = clean(b.job, 200);
        const job = id ? jobs.get(id) : undefined;
        if (!id || !job) { send(res, 404, { status: "unknown", error: "No such job: it was delivered, dropped or never started." }); return; }
        send(res, 200, await answerJob(id, job));
        return;
      }
      // /call: the action may be named by its id or its tool name; identity comes from `caller` and `model` only, never from `input`.
      const name = clean(b.action ?? b.name, 200);
      const action = name && (listActions().some((a) => a.id === name) ? name : actionOfTool(name));
      if (!action) { send(res, 400, { error: `Unknown action: ${String(name)}` }); return; }
      const c = isObject(b.caller) ? b.caller : {};
      const agentId = clean(c.agentId), agentType = clean(c.agentType);
      const caller = { ...(agentId ? { agentId } : {}), ...(agentType ? { agentType } : {}) };
      const [id, job] = startJob(action, b.input ?? {}, caller, clean(b.model));
      send(res, 200, await answerJob(id, job));
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (!res.headersSent) send(res, status, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  const hostFile = `sessions/${options.session}.host.json`;
  let timer: NodeJS.Timeout | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => { resolveClosed = r; });
  const stop = (): Promise<void> => stopping ??= (async () => {
    if (timer) clearInterval(timer);
    server.close();
    server.closeIdleConnections?.();
    await Promise.race([Promise.allSettled([...running]), sleep(limit)]);
    server.closeAllConnections?.();
    try { fs.rmSync(socketPath, { force: true }); } catch { /* gone */ }
    try { removeStoreJson(options.root, hostFile); } catch { /* best effort */ }
    for (const j of jobs.values()) if (j.expiry) clearTimeout(j.expiry);
    resolveClosed();
  })();

  const oldMask = process.umask(0o177); // the socket is created owner-only
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, () => resolve()); });
  } finally { process.umask(oldMask); }
  fs.chmodSync(socketPath, 0o600);
  server.on("error", (e) => process.stderr.write(`session server: ${e.message}\n`));

  // The host version match is recorded in the session's record for the adapter (`reference-cli` §12.6, §12.8).
  if (options.hostVersion !== undefined || options.checkedVersion !== undefined) {
    writeStoreJson(options.root, hostFile, { adapter: "claude", pid: process.pid, host_version: options.hostVersion ?? null, checked_version: options.checkedVersion ?? null,
      match: !!options.hostVersion && options.hostVersion === options.checkedVersion });
  }
  timer = setInterval(() => {
    try { process.kill(options.parentPid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EPERM") void stop(); }
  }, options.parentCheckMs ?? PARENT_CHECK_MS);
  timer.unref();

  return { ready: { socket: socketPath, secret, pid: process.pid, actions: listTools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }, stop, closed };
}
