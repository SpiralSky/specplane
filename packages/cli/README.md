# specplane

**Write down what your project should do, get it reviewed, and keep your AI coding agents inside the lines.**

Specplane is spec-driven development for projects where an AI agent writes some, or most, of the code. Requirements and specifications are plain markdown in your repository. Specplane tracks who approved them, what has been built, and what evidence says it works, and it serves the same operations to Claude Code and Codex as an MCP server, with permissions you control.

- **Approval follows the content.** Change a spec, or something it cites, and it goes back to review with the reason.
- **Agents get limits.** Each permission is `allow`, `request-user` or `deny`. When an agent needs your say-so it files a request, and you accept or decline.
- **Evidence stays separate from claims.** Declared tests run on committed content, and results go stale when a spec changes.
- **Everything lives in git.** Specs are files; approvals, results and records are git notes. No service to run.

Full README and source: [github.com/SpiralSky/specplane](https://github.com/SpiralSky/specplane).

## Install

```sh
npm install -g specplane
```

Needs Node.js 22 or later and git 2.32 or later. The GitHub CLI `gh` is optional, for `plan merge --pr`.

## Quick start

```sh
cd your-repo
specplane init --harness claude   # or --harness codex; leave it out to skip the harness
specplane validate                # format, citations, requirement IDs, status
specplane spec list               # specs with their effective status
specplane spec approve feature/login
specplane warnings
```

`init --harness claude` adds the Claude Code rules, skills, hooks and the Specplane MCP server; `--harness codex` adds a skill, an `AGENTS.md` block and the same server. The optional Claude Code plugin (an approve-or-decline dialogue in the session, and a phone notification through Remote Control) lives in the repository and is not part of this package; see the [harness documentation](https://github.com/SpiralSky/specplane/blob/main/docs/user/harnesses.md).

The documentation is bundled and works offline: `specplane docs` lists the topics, `specplane docs <topic>` reads one, and `specplane docs search <text>` searches them. `specplane --help` lists every command.

## License

[Apache-2.0](https://github.com/SpiralSky/specplane/blob/main/LICENSE)
