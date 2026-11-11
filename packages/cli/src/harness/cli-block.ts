import * as path from "node:path";

/**
 * Keeping the LLM off the CLI (`architecture/reference-cli` §12.7, `harness R47`). `isSpecplaneCommand` splits shell text
 * into simple commands (`;`, `&&`, `||`, `|`, `&`, newlines, subshells, `$(...)`, backticks) and reports whether any of
 * them runs `specplane`, directly, with an `env` or `command` prefix, with a path, through `sh -c`, `npx` or `bunx`.
 * The check is best effort; an adapter's pre-tool hook calls it for shell tool calls and denies a match.
 */

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"]);
const KEYWORDS = new Set(["{", "}", "!", "if", "then", "else", "elif", "do", "while", "until", "time", "nohup", "exec", "command", "builtin", "xargs", "nice", "sudo", "doas"]);
const RUNNERS = new Set(["npx", "bunx", "pnpx"]);
const SUB_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const MAX_DEPTH = 8;

interface Lexed { commands: string[][]; nested: string[] }

/** Split into simple commands of words (quotes removed) and the texts of nested substitutions to check on their own. */
function lex(text: string): Lexed {
  const commands: string[][] = [];
  const nested: string[] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  const endWord = (): void => { if (inWord) words.push(word); word = ""; inWord = false; };
  const endCommand = (): void => { endWord(); if (words.length) commands.push(words); words = []; };
  const balanced = (from: number): number => { // index of the `)` matching a `(` just before `from`
    let depth = 1;
    for (let i = from; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) return i;
    }
    return text.length;
  };
  let quote: "" | "'" | '"' = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") { if (c === "'") quote = ""; else word += c; continue; }
    if (c === "\\" && i + 1 < text.length) { word += text[++i]; inWord = true; continue; }
    if (c === "$" && text[i + 1] === "(") {
      const end = balanced(i + 2);
      nested.push(text.slice(i + 2, end));
      i = end; inWord = true;
      continue;
    }
    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      const stop = end === -1 ? text.length : end;
      nested.push(text.slice(i + 1, stop));
      i = stop; inWord = true;
      continue;
    }
    if (quote === '"') { if (c === '"') quote = ""; else word += c; continue; }
    if (c === "'" || c === '"') { quote = c; inWord = true; continue; }
    if (c === ";" || c === "&" || c === "|" || c === "\n" || c === "(" || c === ")") { endCommand(); continue; }
    if (c === " " || c === "\t" || c === "\r") { endWord(); continue; }
    word += c; inWord = true;
  }
  endCommand();
  return { commands, nested };
}

const isAssignment = (w: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);
const isSpecplaneWord = (w: string): boolean => /^specplane(\.(c|m)?js)?$/.test(path.basename(w));

function commandRuns(words: string[], depth: number): boolean {
  let i = 0;
  for (;;) {
    while (i < words.length && (isAssignment(words[i]) || KEYWORDS.has(words[i]))) i++;
    if (words[i] === "env") { // env [-i] [-u NAME] [VAR=value]... command
      i++;
      while (i < words.length && (words[i].startsWith("-") || isAssignment(words[i]))) i += words[i] === "-u" || words[i] === "--unset" ? 2 : 1;
      continue;
    }
    break;
  }
  const head = words[i];
  if (head === undefined) return false;
  const rest = words.slice(i + 1);
  if (isSpecplaneWord(head)) return true;
  const name = path.basename(head);
  if (SHELLS.has(name)) {
    const c = rest.findIndex((w) => /^-[A-Za-z]*c[A-Za-z]*$/.test(w));
    return c !== -1 && rest[c + 1] !== undefined && check(rest[c + 1], depth + 1);
  }
  let args = rest;
  if (SUB_RUNNERS.has(name)) {
    if (args[0] !== "exec" && args[0] !== "dlx" && args[0] !== "x" && args[0] !== "run") return false;
    args = args.slice(1);
  } else if (!RUNNERS.has(name)) return false;
  const pkg = args.find((w) => !w.startsWith("-"));
  return pkg !== undefined && (isSpecplaneWord(pkg) || pkg.startsWith("specplane@"));
}

function check(text: string, depth: number): boolean {
  if (depth > MAX_DEPTH) return true; // Too deeply nested to judge; refuse rather than allow.
  const { commands, nested } = lex(text);
  return commands.some((w) => commandRuns(w, depth)) || nested.some((n) => check(n, depth + 1));
}

/** True when the shell text runs the Specplane CLI in any of the forms of `reference-cli` §12.7. */
export function isSpecplaneCommand(shellText: string): boolean {
  return check(shellText, 0);
}

/** The message an adapter's pre-tool hook returns when it denies a match (`harness R47`). */
export const CLI_BLOCK_MESSAGE =
  "The Specplane CLI is for people. Use the Specplane harness actions instead, or ask the user to run the command.";
