// Host-independent logic for the Specplane slash commands in Claude Code
// (harnesses/claude/specifications/architecture/claude-integration §3, reference-cli §12.2). Nothing here imports the
// host: the core arrives as a port, so the same code is exercised by the repository's Bun suite. A command typed with
// no arguments runs its `[code]` steps through `specplane harness run` and never makes a model turn; a command that
// needs the assistant and has arguments is handed to its skill with those arguments.

export interface SlashCommand {
  /** The slash-command name registered with the host, also the command contract and the `specplane-<name>` skill. */
  name: string
  description: string
  argumentHint: string
  /** With arguments, the command is handed to the assistant (the user-command runner would only pass it on). */
  modelWithArgs: boolean
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'spec-assist', description: 'Write a feature spec with you', argumentHint: '<spec or description>', modelWithArgs: true },
  { name: 'spec-draft-architecture', description: 'Draft an architecture spec from feature specs', argumentHint: '<feature spec id>...', modelWithArgs: true },
  { name: 'plan-create', description: 'Create a new plan', argumentHint: '<what the plan is for>', modelWithArgs: true },
  { name: 'plan-start', description: 'Start a plan and open its session', argumentHint: '<plan-id>', modelWithArgs: false },
  { name: 'plan-step', description: 'Execute the next step of a plan', argumentHint: '[plan-id]', modelWithArgs: true },
  { name: 'plan-finish', description: 'Run the final review of a plan', argumentHint: '[plan-id]', modelWithArgs: true },
  { name: 'plan-abandon', description: 'Abandon a plan after your confirmation', argumentHint: '<plan-id>', modelWithArgs: true },
  { name: 'plan-status', description: 'Show plans with live status and the next step', argumentHint: '[plan-id]', modelWithArgs: false },
  { name: 'validate', description: 'Run Specplane validation', argumentHint: '[scope]', modelWithArgs: true },
  { name: 'verify', description: 'Judge an architecture spec against its implementation', argumentHint: '<architecture spec id>', modelWithArgs: true },
  { name: 'approve', description: 'Approve specs, plans or decision records by ID', argumentHint: '<id>...', modelWithArgs: false },
  { name: 'spec-view', description: 'View a spec and what changed since its last approval', argumentHint: '[spec id]', modelWithArgs: false },
  { name: 'decision-new', description: 'Record a decision you made as a decision record', argumentHint: '[what was decided]', modelWithArgs: true },
  { name: 'spec-review', description: 'Review specs read-only and discuss problems, gaps and wording', argumentHint: '[spec id... | all]', modelWithArgs: true },
  { name: 'migrate', description: 'Bring an existing project into Specplane', argumentHint: '[what to migrate from]', modelWithArgs: true },
  { name: 'requests', description: 'Show the requests waiting for you', argumentHint: '[list | show <id> | accept <id> | decline <id>]', modelWithArgs: false },
]

/** The bundled core, as the plugin ships it; the host has no shell, so the process is run through the engine. */
export const BUNDLED_CLI = 'core/dist/cli.js'

export interface CliResult { exitCode: number; stdout: string; stderr: string }
export interface CorePort { run(argv: string[], signal?: AbortSignal): Promise<CliResult> }
export interface CommandOutput { text: string; exitCode?: number }
export interface CommandOutcome { output: CommandOutput; /** Text to submit to the assistant after this command's turn. */ prompt?: string }

/** Split typed arguments on spaces, keeping single or double quoted text together (quotes removed). */
export function splitArgs(raw: string): string[] {
  const out: string[] = []
  let word = ''
  let quote = ''
  let inWord = false
  for (const c of raw) {
    if (quote) { if (c === quote) quote = ''; else word += c; continue }
    if (c === '"' || c === "'") { quote = c; inWord = true; continue }
    if (/\s/.test(c)) { if (inWord) out.push(word); word = ''; inWord = false; continue }
    word += c; inWord = true
  }
  if (inWord) out.push(word)
  return out
}

/** The one line handed to the assistant: the skill to use and the arguments as typed, as data. */
export function skillPrompt(name: string, args: string[]): string {
  return `Use the specplane-${name} skill. Arguments: ${JSON.stringify(args)}`
}

export interface AskPort { ask(question: string, options: string[] | { options: string[]; header?: string; multiSelect?: boolean }): Promise<string> }

/** The dialogue shows at most this many diff lines; the rest is named, not dropped silently. */
export const DIFF_LINE_LIMIT = 60
export const DIALOGUE_LABELS = ['Accept', 'Decline', 'Skip'] as const
export const ANSWER_LINE = 'Answer with /requests accept <id> or /requests decline <id>.'

export interface RequestView {
  id: string; state?: string; reason?: string; diff?: string | null; warning?: string
  from?: { role?: string }; action?: { command?: string }; permissions?: string[]
}

/** Control characters (and colour escapes) out of a core string; newlines stay, every other run of blanks collapses. */
export function cleanText(s: string): string {
  return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .split('\n').map(l => l.replace(/ {2,}/g, ' ').trim()).filter(Boolean).join('\n')
}

/** The text of one dialogue: sender, action, reason, a warning when the current diff is unavailable, and the diff (`-`/`+` lines). */
export function dialogueText(r: RequestView): string {
  const lines = [`Request ${r.id} from ${r.from?.role ?? 'unknown'}: ${r.action?.command ?? 'unknown action'}`, `Reason: ${r.reason ?? ''}`]
  if (typeof r.warning === 'string' && r.warning.trim() !== '') lines.push(`Warning: ${r.warning.trim()}`)
  if (typeof r.diff === 'string' && r.diff.trim() !== '') {
    const d = r.diff.replace(/\n$/, '').split('\n')
    lines.push('', ...d.slice(0, DIFF_LINE_LIMIT))
    if (d.length > DIFF_LINE_LIMIT) lines.push(`... ${d.length - DIFF_LINE_LIMIT} more lines; see \`specplane requests show ${r.id}\``)
  }
  return lines.join('\n')
}

/** The auto-warn line the core appends to a text result (`N warnings; run ...`): not part of the message. */
const COUNT_LINE = /^(\d+ warnings?(; run .*)?|warnings unavailable)$/
/** The user-facing message lines of a core result: cleaned, without the warning count line, stdout then stderr, one per line. */
const resultLines = (r: CliResult): string[] => cleanText(r.stdout).split('\n').filter(l => l && !COUNT_LINE.test(l)).concat(cleanText(r.stderr).split('\n').filter(Boolean))
const asText = (r: CliResult): string => resultLines(r).join('\n')

/** The core marks a written-but-uncommitted file with a `Commit it to apply:` line followed by the ready-to-run `git add ... && git commit ...` line (`packages/cli/src/uncommitted.ts`); the same paths are in `data.uncommitted` of a `--json` result. Only a failed `requests accept --commit` leaves these lines (a successful one prints `Committed ... in effect now.`); the notice is for that fallback, else undefined. */
export function uncommittedNote(text: string): string | undefined {
  const lines = text.split('\n')
  const i = lines.findIndex(l => l.trim() === 'Commit it to apply:')
  const cmd = i >= 0 ? lines[i + 1]?.trim() : undefined
  return cmd && cmd.startsWith('git add ') ? `Not yet in effect: commit to apply.\n${cmd}` : undefined
}

/** One answered request: what the user chose and whether the core did it. */
export interface Outcome { id: string; answer: 'Accept' | 'Decline'; failed: boolean; message: string }

/**
 * Open the dialogue for each request in turn. `lines` are the output lines of the answers so far; `done` is false when
 * the dialogue was unavailable, dismissed or answered with something that is not a label (the caller then falls back
 * to the text list, after the lines already produced). `outcomes` collects the Accept and Decline answers.
 */
export async function runDialogue(requests: RequestView[], ask: AskPort, core: CorePort, signal?: AbortSignal, outcomes?: Outcome[]): Promise<{ lines: string[]; done: boolean }> {
  const out: string[] = []
  for (const r of requests) {
    let answer: string
    try { answer = await ask.ask(dialogueText(r), { options: [...DIALOGUE_LABELS], header: 'Request' }) } catch { return { lines: out, done: false } }
    if (answer !== 'Accept' && answer !== 'Decline' && answer !== 'Skip') return { lines: out, done: false }
    if (answer === 'Skip') { out.push(`Skipped ${r.id}; it stays pending.`); continue }
    out.push(...await answerOne(r, answer, core, signal, outcomes))
  }
  return { lines: out, done: true }
}

/** Run Accept or Decline for one request through the core (as the person); returns its output lines (the uncommitted note after a good Accept) and records the outcome. */
async function answerOne(r: RequestView, answer: 'Accept' | 'Decline', core: CorePort, signal?: AbortSignal, outcomes?: Outcome[]): Promise<string[]> {
  const out: string[] = []
  try {
    const res = await core.run(['harness', 'run', '--adapter', 'claude', 'requests', ...(answer === 'Accept' ? ['accept', r.id, '--commit'] : ['decline', r.id])], signal)
    const text = asText(res)
    out.push(text || `${answer} ${r.id}: done.`)
    if (answer === 'Accept' && res.exitCode === 0) { const note = uncommittedNote(text); if (note) out.push(note) }
    outcomes?.push({ id: r.id, answer, failed: res.exitCode !== 0 || /could not be done/.test(text), message: text.replace(/\n/g, ' ') })
  } catch (e) {
    const m = cleanText(`Could not ${answer.toLowerCase()} ${r.id}: ${e instanceof Error ? e.message : String(e)}`).replace(/\n/g, ' ')
    out.push(m)
    outcomes?.push({ id: r.id, answer, failed: true, message: m })
  }
  return out
}

export const SELECT_LABELS = ['Accept', 'Decline', 'Go through one by one', 'Cancel'] as const
export const MORE_LABEL = 'More…'
const oneLine = (t: string): string => cleanText(t).replace(/\n/g, ' ')

/** The option label of one request in the selection pane: id and a shortened action (the id keeps it unique). */
export function requestLabel(r: RequestView): string {
  const action = oneLine(r.action?.command ?? 'unknown action')
  return `${r.id}: ${action.length > 40 ? `${action.slice(0, 39)}…` : action}`
}

/** The detail line under the question for one request: sender, and a mark for a spec change (its diff shows only when answered alone). `AskOptions` here takes plain string labels, so the detail goes in the question text. */
function requestDetail(r: RequestView, label: string): string {
  const spec = typeof r.diff === 'string' && r.diff.trim() !== '' ? ' (spec change; diff shown when answered alone)' : ''
  return `- ${label} from ${oneLine(r.from?.role ?? 'unknown')}${spec}`
}

/** Which of `labels` a multi-select answer names. The answer format is unverified against a live host: the labels are expected comma-separated, so each label is looked for in the answer text. */
export function selectedLabels(answer: string, labels: string[]): string[] {
  return scanAnswer(answer, labels).picked
}

/** Matches labels longest first, cutting each match out of the text so a label that ends in another label (a truncated action ending in `More…`) cannot also select the shorter one. `rest` is what no label accounted for. */
function scanAnswer(answer: string, labels: string[]): { picked: string[]; rest: string } {
  let rest = answer
  const picked = new Set<string>()
  for (const l of [...new Set(labels)].sort((a, b) => b.length - a.length)) {
    if (!rest.includes(l)) continue
    picked.add(l)
    rest = rest.split(l).join(' ')
  }
  return { picked: labels.filter(l => picked.has(l)), rest }
}

/**
 * With two or more pending requests: a multi-select pane (pages of up to 4 options; with more than 4 left, 3 requests
 * plus `More…`, which keeps the selections and shows the next page). One selected request gets `runDialogue`; two or more
 * get Accept / Decline / Go through one by one / Cancel. Each request is answered in turn and a failure does not stop the
 * rest; the uncommitted note appears once per distinct commit command. `done` is false when the pane was unavailable,
 * dismissed, empty or answered with something unrecognised (the caller falls back to the text list).
 */
export async function runSelectionPane(requests: RequestView[], ask: AskPort, core: CorePort, signal?: AbortSignal): Promise<{ lines: string[]; done: boolean }> {
  const fail = { lines: [] as string[], done: false }
  const chosen = new Set<string>()
  let i = 0
  while (i < requests.length) {
    const left = requests.length - i
    const page = requests.slice(i, i + (left > 4 ? 3 : left))
    const labels = page.map(requestLabel)
    const options = [...labels]
    const more = left > 4
    if (more) options.push(MORE_LABEL)
    let answer: string
    try { answer = await ask.ask(['Select requests to answer', ...page.map((r, k) => requestDetail(r, labels[k]!))].join('\n'), { options, header: 'Requests', multiSelect: true }) } catch { return fail }
    const scan = scanAnswer(answer, more ? [...labels, MORE_LABEL] : labels)
    const picked = scan.picked.filter(l => l !== MORE_LABEL)
    for (const l of picked) chosen.add(l)
    const wantsMore = more && scan.picked.includes(MORE_LABEL)
    if (!wantsMore) { if (!more && picked.length === 0 && chosen.size === 0) return fail; break }
    i += page.length
  }
  const selection = requests.filter(r => chosen.has(requestLabel(r)))
  if (selection.length === 0) return fail
  if (selection.length === 1) return runDialogue(selection, ask, core, signal)
  let answer: string
  try { answer = await ask.ask(`Answer the ${selection.length} selected requests`, { options: [...SELECT_LABELS], header: 'Requests' }) } catch { return fail }
  if (answer === 'Cancel') return { lines: ['Cancelled; the selected requests stay pending.'], done: true }
  if (answer === 'Go through one by one') return runDialogue(selection, ask, core, signal)
  if (answer !== 'Accept' && answer !== 'Decline') return fail
  const lines: string[] = []
  const notes = new Set<string>()
  for (const r of selection) {
    for (const l of await answerOne(r, answer, core, signal)) {
      if (l.startsWith('Not yet in effect: commit to apply.\n')) notes.add(l); else lines.push(l)
    }
  }
  return { lines: [...lines, ...notes], done: true }
}

/** The pending requests from `requests list --json`, each re-read with `requests show` (the list holds the diff stored at creation, `show` recomputes it). Null when the core did not give a usable list. */
async function pendingRequests(core: CorePort, signal?: AbortSignal): Promise<RequestView[] | null> {
  try {
    const r = await core.run(['harness', 'run', '--adapter', 'claude', 'requests', 'list', '--json'], signal)
    if (r.exitCode !== 0) return null
    const data = (JSON.parse(r.stdout) as { data?: unknown }).data
    if (!Array.isArray(data)) return null
    const pending = (data as RequestView[]).filter(x => x && x.state === 'pending')
    const fresh: RequestView[] = []
    for (const p of pending) {
      try {
        const s = await core.run(['harness', 'run', '--adapter', 'claude', 'requests', 'show', p.id, '--json'], signal)
        const rec = s.exitCode === 0 ? (JSON.parse(s.stdout) as { data?: RequestView | null }).data : null
        fresh.push(rec && rec.id === p.id ? rec : p)
      } catch { fresh.push(p) }
    }
    return fresh
  } catch { return null }
}

/** The id of the request a Specplane tool reply says was created (any action: `request_send` or a held write), else undefined. */
export function createdRequestId(replyText: string): string | undefined {
  try {
    const b = JSON.parse(replyText) as { request?: unknown } | null
    return b && typeof b.request === 'string' && b.request ? b.request : undefined
  } catch { return undefined }
}

/** The host's push notification channel (`$.ui.notify` and `$.ui.cancelNotify`); `notify` resolves whether the notification was sent. */
export interface PushPort {
  notify(text: string, opts: { title: string; key: string }): Promise<{ isSent: boolean }>
  cancel(key: string): Promise<unknown>
}

async function configValue(core: CorePort, key: string): Promise<unknown> {
  const r = await core.run(['config', 'get', key, '--json'])
  if (r.exitCode !== 0) return undefined
  return (JSON.parse(r.stdout) as { data?: { value?: unknown } }).data?.value
}

/** Whether the settings ask for a push notification of this request: `notifications.push` on and, unless the list has `all`, one of its permissions in `notifications.push_permissions` (`root:requests R52.5`). */
export async function wantsPush(rec: RequestView, core: CorePort): Promise<boolean> {
  if ((await configValue(core, 'notifications.push')) !== true) return false
  const list = await configValue(core, 'notifications.push_permissions')
  const perms = Array.isArray(list) ? list.map(String) : ['all']
  return perms.includes('all') || (rec.permissions ?? []).some(p => perms.includes(p))
}

/** The one short summary a notification carries: no diff, no reason, no way to answer (`root:requests R52.5`). */
export function pushText(rec: RequestView): string {
  const cmd = cleanText(rec.action?.command ?? 'an action').replace(/\n/g, ' ').slice(0, 80)
  const from = cleanText(rec.from?.role ?? 'llm').replace(/\n/g, ' ').slice(0, 40)
  return `Specplane: a request is waiting: ${cmd} (from ${from}). Open /requests to answer.`
}

/** What the model is told after an answered arrival dialogue: a line for the reply, or a prompt where the reply cannot be changed. */
export type ArrivalNote = { line: string; prompt: string }

/**
 * The arrival dialogue: after a reply that created a request, ask about it. Never throws; the reply text is not touched
 * here. `seen` holds the request ids already shown, so a request reached by two routes opens one dialogue; an id whose
 * dialogue could not open (the core failed, the question was dismissed) is removed again so a later reply can retry.
 * Returns what to tell the model about the answer (Accept or Decline only), else undefined.
 */
export async function arrivalDialogue(replyText: string, ask: AskPort, core: CorePort, log: (m: string) => void, seen?: Set<string>, push?: PushPort): Promise<ArrivalNote | undefined> {
  const id = createdRequestId(replyText)
  if (!id) return undefined
  if (seen?.has(id)) return undefined
  seen?.add(id)
  try {
    const r = await core.run(['harness', 'run', '--adapter', 'claude', 'requests', 'show', id, '--json'])
    if (r.exitCode !== 0) { seen?.delete(id); return undefined }
    const rec = (JSON.parse(r.stdout) as { data?: RequestView | null }).data
    if (!rec || rec.state !== 'pending') return undefined
    // The notification goes out before the dialogue, which blocks (and is rejected in a `-p` run).
    const key = `specplane-request-${rec.id}`
    let pushed = false
    if (push) {
      try {
        if (await wantsPush(rec, core)) {
          const sent = await push.notify(pushText(rec), { title: 'Specplane', key })
          pushed = !!sent?.isSent
          if (!pushed) log('specplane: the host did not send the push notification (no client raised it); answer in the dialogue or with /requests.')
        }
      } catch (e) { log(cleanText(`specplane: the request notification failed: ${e instanceof Error ? e.message : String(e)}`)) }
    }
    const outcomes: Outcome[] = []
    const { lines, done } = await runDialogue([rec], ask, core, undefined, outcomes)
    if (pushed && outcomes[0]) { try { await push!.cancel(key) } catch { /* a notification that stays is harmless */ } }
    for (const l of lines) log(l)
    if (!done) seen?.delete(id)
    const o = outcomes[0]
    if (!o) return undefined
    const verb = o.answer === 'Accept' ? 'accepted' : 'declined'
    const short = o.message && o.message.length <= 200 ? o.message : ''
    if (o.failed) {
      // The core's text is a fixed sentence ("... marked failed and will not be retried: ") and then the reason; keep the reason.
      const reason = o.message.replace(/^.*?marked failed and will not be retried:\s*/, '').trim()
      const why = (reason && reason.length <= 400 ? reason : '') || short || 'see the transcript'
      return {
        line: `The user answered this request in the dialogue: ${verb}${o.answer === 'Accept' ? ' but the action failed' : ', but it failed'}: ${why}`,
        prompt: `Specplane: request ${id} was ${verb} by the user but the action failed: ${why}. Do not send it again.`,
      }
    }
    return {
      line: `The user answered this request in the dialogue: ${verb}.${short ? ` ${short}` : ''}`,
      prompt: `Specplane: request ${id} was ${verb} by the user${short ? ` (${short})` : ''}. Do not send it again.`,
    }
  } catch (e) { seen?.delete(id); log(cleanText(`specplane: the request dialogue failed: ${e instanceof Error ? e.message : String(e)}`)); return undefined }
}

/** Run one typed command. Nothing here can call a model; a prompt is only returned for the host to submit. */
export async function dispatch(cmd: SlashCommand, rawArgs: string, core: CorePort, signal?: AbortSignal, ask?: AskPort): Promise<CommandOutcome> {
  const args = splitArgs(rawArgs)
  if (cmd.name === 'requests' && args.length === 0 && ask) {
    const pending = await pendingRequests(core, signal)
    if (pending && pending.length === 0) return { output: { text: 'No requests waiting.' } }
    if (pending) {
      const { lines, done } = pending.length >= 2 ? await runSelectionPane(pending, ask, core, signal) : await runDialogue(pending, ask, core, signal)
      if (done) return { output: { text: lines.join('\n') } }
      const plain = await dispatch(cmd, rawArgs, core, signal)
      return { output: { ...plain.output, text: [...lines, plain.output.text, ANSWER_LINE].join('\n') } }
    }
  }
  if (cmd.modelWithArgs && args.length > 0) {
    return { output: { text: `/${cmd.name}: handing your arguments to the assistant.` }, prompt: skillPrompt(cmd.name, args) }
  }
  let r: CliResult
  // A typed `accept` is the person's accept too: the core commits the config or preset file it writes, so it is in effect at once.
  const argv = cmd.name === 'requests' && args[0] === 'accept' && !args.includes('--commit') ? [...args, '--commit'] : args
  try { r = await core.run(['harness', 'run', '--adapter', 'claude', cmd.name, ...argv], signal) } catch (e) {
    return { output: { text: `/${cmd.name} could not run the Specplane core: ${e instanceof Error ? e.message : String(e)}`, exitCode: 1 } }
  }
  const text = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n') || `/${cmd.name}: done.`
  return { output: r.exitCode === 0 ? { text } : { text, exitCode: r.exitCode } }
}
