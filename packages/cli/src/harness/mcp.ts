import { takeCaller, toolUseIdOf } from "./caller.js";
import * as readline from "node:readline";
import { createActionRuntime, listActions, type ActionReply, type ActionSession } from "./actions.js";

/**
 * The Specplane MCP server (`architecture/reference-cli` §12.1 channel): JSON-RPC 2.0 over newline-delimited stdio with
 * `initialize`, `ping`, `tools/list` and `tools/call`. One tool per harness action, each carrying its own input schema.
 * Every call runs in this process through `createActionRuntime`, so the permission check, audit and instruction delivery
 * happen here and the actor is the LLM of the one session this server belongs to; tool input never names a role.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Tool names use `_` for `.` (`spec.retrieve` becomes `spec_retrieve`), which every host accepts. */
export const toolName = (actionId: string): string => actionId.replace(/\./g, "_");

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const failure = (id: unknown, code: number, message: string): string => JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const success = (id: unknown, result: unknown): string => JSON.stringify({ jsonrpc: "2.0", id, result });

/** The text an MCP tool result carries for a reply; the session server returns the same text (`reference-cli` §12.8). */
export const replyText = (reply: ActionReply): string => JSON.stringify(reply);

/** The action id a tool name stands for (`spec_retrieve` is `spec.retrieve`), or undefined when there is none. */
export function actionOfTool(name: unknown): string | undefined {
  return typeof name === "string" ? listActions().find((a) => toolName(a.id) === name)?.id : undefined;
}

export function listTools(): { name: string; description: string; inputSchema: unknown }[] {
  // Permissions can depend on the input (a spec write needs the layer's permission), so the description does not list them.
  return listActions().map((a) => ({
    name: toolName(a.id),
    description: `Specplane action \`${a.id}\`${a.readOnly ? " (read-only)" : ""}. Permissions are checked in the Specplane process on every call.`,
    inputSchema: a.inputSchema,
  }));
}

export interface McpServerOptions { name?: string; version?: string }

export function createMcpServer(session: ActionSession, options: McpServerOptions = {}) {
  const runtime = createActionRuntime(session);
  const byTool = new Map(listActions().map((a) => [toolName(a.id), a.id]));
  return {
    /** One request line in; the reply line out, or null for a notification. */
    async handleLine(line: string): Promise<string | null> {
      let message: unknown;
      try { message = JSON.parse(line); } catch { return failure(null, -32700, "Parse error"); }
      if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") return failure(isObject(message) ? message.id : null, -32600, "Invalid request");
      const { id, method } = message;
      if (!("id" in message)) return null; // notifications such as notifications/initialized
      const params = isObject(message.params) ? message.params : {};
      try { return await dispatch(id, method as string, params); }
      catch (e) { return failure(id, -32603, `Internal error: ${e instanceof Error ? e.message : String(e)}`); }
    },
    /** Serve until the input ends; requests are answered in order. */
    async serve(io: { input: NodeJS.ReadableStream; write: (line: string) => void }): Promise<void> {
      let chain = Promise.resolve();
      const lines = readline.createInterface({ input: io.input, crlfDelay: Infinity });
      lines.on("line", (line) => {
        if (!line.trim()) return;
        chain = chain.then(async () => { const out = await this.handleLine(line); if (out !== null) io.write(`${out}\n`); });
      });
      await new Promise<void>((resolve) => lines.once("close", resolve));
      await chain;
    },
  };
  async function dispatch(id: unknown, method: string, params: Json): Promise<string> {
      switch (method) {
        case "initialize":
          return success(id, { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: options.name ?? "specplane", version: options.version ?? "0.1.0" } });
        case "ping": return success(id, {});
        case "tools/list": return success(id, { tools: listTools() });
        case "tools/call": {
          const action = typeof params.name === "string" ? byTool.get(params.name) : undefined;
          if (!action) return failure(id, -32602, `Unknown tool: ${String(params.name)}`);
          const reply = await runtime.call(action, params.arguments ?? {}, takeCaller(session.root, toolUseIdOf(params)));
          return success(id, { content: [{ type: "text", text: replyText(reply) }], isError: !reply.ok });
        }
        default: return failure(id, -32601, `Method not found: ${method}`);
      }
  }
}
