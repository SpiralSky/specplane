import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const serverScript = path.join(repo, "harnesses/claude/host-evidence/2.1.322-socket-probe/hooks/server.cjs");

function sendUnixRequest(socketPath: string, method: string, urlPath: string, payload?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const body = payload !== undefined ? JSON.stringify(payload) : undefined;
    const req = http.request({
      socketPath,
      path: urlPath,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
    }, res => {
      let raw = "";
      res.on("data", chunk => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: { raw } });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("Probe request timed out")));
    if (body) req.write(body);
    req.end();
  });
}

function startServer(socketPath: string): Promise<{ proc: ReturnType<typeof spawn>; stdoutChunks: string[] }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [serverScript, socketPath], { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: string[] = [];
    let ready = false;
    let output = "";
    let errors = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`Probe startup timed out: ${errors}`));
    }, 5000);
    proc.stderr?.on("data", chunk => { errors += chunk.toString(); });

    proc.stdout?.on("data", chunk => {
      const text = chunk.toString();
      stdoutChunks.push(text);
      output += text;
      if (!ready && output.includes("READY")) {
        clearTimeout(timer);
        ready = true;
        resolve({ proc, stdoutChunks });
      }
    });

    proc.on("error", error => { clearTimeout(timer); reject(error); });
    proc.on("exit", code => {
      clearTimeout(timer);
      if (!ready) reject(new Error(`Server exited early with code ${code}: ${errors}`));
    });
  });
}

test("socket probe server maintains process state, increments counter, and handles stream draining", async () => {
  const socketPath = path.join(os.tmpdir(), `probe-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sock`);
  const { proc, stdoutChunks } = await startServer(socketPath);

  try {
    // 1. Initial request verifies process identity and initial count
    const res1 = await sendUnixRequest(socketPath, "POST", "/probe", { test: "initial" });
    assert.equal(res1.status, 200);
    assert.equal(res1.data.ok, true);
    assert.equal(res1.data.pid, proc.pid);
    assert.equal(res1.data.requestCount, 1);

    // 2. Second request verifies long-lived process reuse
    const res2 = await sendUnixRequest(socketPath, "POST", "/probe", { test: "second" });
    assert.equal(res2.status, 200);
    assert.equal(res2.data.pid, proc.pid);
    assert.equal(res2.data.requestCount, 2);

    // 3. Synthetic metadata round-trip; this does not prove host identity.
    const res3 = await sendUnixRequest(socketPath, "POST", "/probe", {
      agentId: "sub-probe-42",
      agentType: "general-purpose",
      model: "claude-haiku",
    });
    assert.equal(res3.status, 200);
    assert.equal(res3.data.requestCount, 3);
    assert.equal(res3.data.received.agentId, "sub-probe-42");
    assert.equal(res3.data.received.agentType, "general-purpose");

    // 4. Test stream draining under output flood
    const resFlood = await sendUnixRequest(socketPath, "POST", "/flood", { size: 2097152 });
    assert.equal(resFlood.status, 200);
    assert.equal(resFlood.data.flooded, 2097152);

    // 5. Graceful shutdown closes server and unlinks socket file
    const exitPromise = new Promise<number | null>(resolve => proc.on("exit", resolve));
    const resShutdown = await sendUnixRequest(socketPath, "POST", "/shutdown");
    assert.equal(resShutdown.status, 200);
    assert.equal(resShutdown.data.shuttingDown, true);

    const exitCode = await exitPromise;
    assert.ok(stdoutChunks.join("").includes("F".repeat(2097152)));
    assert.equal(exitCode, 0);
    assert.equal(fs.existsSync(socketPath), false);
  } finally {
    if (!proc.killed) proc.kill("SIGKILL");
    try { fs.unlinkSync(socketPath); } catch {}
  }
});

test("unclean termination leaves a stale socket and restart does not remove it", async () => {
  const socketPath = path.join(os.tmpdir(), `probe-kill-${Date.now()}.sock`);
  const { proc } = await startServer(socketPath);
  try {
    const exited = new Promise<void>(resolve => proc.once("exit", () => resolve()));
    proc.kill("SIGKILL");
    await exited;
    assert.equal(fs.existsSync(socketPath), true);
    await assert.rejects(startServer(socketPath), /EADDRINUSE/);
    assert.equal(fs.existsSync(socketPath), true, "a failed start must not unlink someone else's socket");
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    try { fs.unlinkSync(socketPath); } catch {}
  }
});

test("socket probe server crash drops connection and terminates child", async () => {
  const socketPath = path.join(os.tmpdir(), `probe-crash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sock`);
  const { proc } = await startServer(socketPath);

  try {
    const exitPromise = new Promise<number | null>(resolve => proc.on("exit", resolve));
    const resCrash = await sendUnixRequest(socketPath, "POST", "/crash");
    assert.equal(resCrash.status, 500);
    assert.equal(resCrash.data.crashing, true);

    const exitCode = await exitPromise;
    assert.equal(exitCode, 42);

    // After crash, connection must fail
    await assert.rejects(
      sendUnixRequest(socketPath, "POST", "/probe"),
      /(ECONNREFUSED|ENOENT)/
    );
  } finally {
    if (!proc.killed) proc.kill("SIGKILL");
    try { fs.unlinkSync(socketPath); } catch {}
  }
});
