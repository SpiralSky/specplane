import { PreconditionError } from "../errors.js";
import { noCapabilities, type Capabilities, type HarnessAdapter } from "./adapter.js";
import { worktreeOf } from "../plan/ctx.js";
import type { SessionLauncher } from "./run.js";
import { randomUUID } from "node:crypto";

/**
 * The Codex adapter (`harnesses/codex/specifications/architecture/codex-integration` §3 to §6). Nothing Codex does is
 * claimed until each surface has had a live check with the user's approval (`§7`, `harness R35.1`): the skill table and
 * contracts exist, but whether Codex loads them on demand, runs a native command without a model turn, blocks a shell
 * call or reports usage is unverified, so every capability is missing and setup and the actions say so by name, except `subagents`, which was
 * checked live with Codex 0.169.0 (a subagent started by Codex calls a Specplane tool). Subagents carry no identity there,
 * so `subagent-identity` stays missing.
 *
 * Model identity: Codex exposes none that Specplane has verified, so a write through the action channel records the
 * author as `unknown` (`codex-integration` §6) and never a guess from the product name.
 */
export const codexAdapter: HarnessAdapter = {
  name: "codex",
  capabilities(): Capabilities { return { ...noCapabilities(), subagents: true }; },
};

/**
 * `plan-start` for Codex (`codex-integration` §5): launching `codex exec` is a capability the adapter does not report, so
 * the launch is refused with the reason and the command that opens Codex in the plan's checkout (an assumption: `codex`
 * started with the checkout as its working directory). Nothing else is used in its place.
 */
export const codexLauncher: SessionLauncher = {
  name: "codex",
  newSessionId: () => `codex-${randomUUID()}`,
  open(ctx, planId) {
    const dir = worktreeOf(ctx.root, planId) ?? `the checkout of plan ${planId}`;
    throw new PreconditionError([
      `Opening a plan session needs the ability to launch \`codex exec\`, which this Codex setup is not verified to have; no session was opened.`,
      `To continue the plan yourself, open Codex in its checkout: cd ${dir} && codex`,
    ]);
  },
};
