---
id: decision/0002
title: Use TypeScript (Node.js) for the reference CLI
date: 2026-10-28
status: superseded
superseded_by: decision/0004
related_specs: [architecture/reference-cli]
---

# Use TypeScript (Node.js) for the reference CLI

## Context

The reference CLI needs a language and runtime. The criteria are:
- Easy distribution to developers across macOS, Linux, and Windows.
- Good ecosystem for YAML parsing, JSON Schema validation, and git shelling.
- Readable by contributors who are likely working in agent-tooling ecosystems.
- Reasonable startup time for a CLI tool.
- MIT-compatible dependencies available.

## Options considered

### TypeScript (Node.js)

**Pros**: npm distribution is universal among developers (`npm install -g specplane`); the agent-tooling ecosystem (Claude Code, LangChain, Vercel AI SDK) is primarily TypeScript; excellent YAML (`js-yaml`) and JSON Schema (`ajv`) libraries; familiar to front-end and full-stack developers.  
**Cons**: Node.js startup adds ~80–150ms; requires Node.js to be installed (nearly universal in 2026); TypeScript compilation step needed before distribution.

### Go

**Pros**: single static binary, no runtime required; fast startup; excellent for CLI tools (Cobra); good git library (`go-git`).  
**Cons**: Go is less familiar to the target audience (agent/web tooling contributors); npm distribution requires wrapping in a shell script or using a pre-built binary download, which is more friction than `npm install`; smaller ecosystem for the specific libraries needed.

### Python

**Pros**: very common in ML/AI adjacent projects; `PyYAML`, `jsonschema` are mature.  
**Cons**: Python packaging for CLI tools (`pipx`, `pip install`) is more fragmented than npm; startup time similar to Node; `uv` tooling improves this but is not yet universal.

### Rust

**Pros**: single binary, very fast, excellent type safety.  
**Cons**: steep learning curve narrows the contributor pool; compilation is slow; the ecosystem for the specific needs (YAML, JSON Schema, git) requires more manual assembly.

## Decision

Use **TypeScript (Node.js)** for the reference CLI, distributed via npm as `specplane` (or scoped `@specplane/cli`).

TypeScript offers the best alignment between distribution simplicity (`npm install -g`) and ecosystem familiarity for the target audience of AI-assisted development tooling.

## Consequences

- The CLI requires Node.js ≥ 18 (LTS). This is a documented prerequisite.
- The build step (TypeScript → JavaScript) is handled by `tsc` or `esbuild`; the npm package ships compiled JavaScript.
- Contributors working in other languages can still implement compatible CLIs — the format specification is language-agnostic. The TypeScript implementation is the reference, not the exclusive, implementation.
- If startup time becomes a problem, the CLI can be compiled to a single binary with `pkg` or `bun build --compile` as a future optimisation without changing the public interface.
