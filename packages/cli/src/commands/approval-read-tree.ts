import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../git/exec.js";
import { PlanStateError } from "../errors.js";

interface ValidationPaths { plans: string; decisions: string; specs: string[] }

const normalize = (p: string) => path.posix.normalize(p.replaceAll("\\", "/")).replace(/\/$/, "") || ".";
const beneath = (file: string, dir: string): string | null => dir === "." ? file : file.startsWith(`${dir}/`) ? file.slice(dir.length + 1) : null;
const ancestor = (file: string, dir: string) => file === dir || dir.startsWith(`${file}/`);
// Only a link to a known committed regular file can be excluded as a directory.
const couldBeDirectory = (knownFileLink: boolean) => !knownFileLink;

/** Match the discovery shapes used by listPlans, listStepFiles, loadSpecs and loadAdrs. */
function relevant(file: string, knownFileLink: boolean, paths: ValidationPaths): boolean {
  const plans = normalize(paths.plans), decisions = normalize(paths.decisions);
  const specDirs = paths.specs.flatMap(root => ["features", "architecture"].map(type => normalize(path.posix.join(root.replaceAll("\\", "/"), type))));
  if ([plans, decisions, ...specDirs].some(dir => ancestor(file, dir))) return true;
  const planPath = beneath(file, plans);
  if (planPath !== null) {
    const parts = planPath.split("/");
    if (parts[0] === "archive") parts.shift();
    if (parts.length === 0) return true;
    if (parts.length === 1 && couldBeDirectory(knownFileLink)) return true;
    if (parts.length === 2 && ["PLAN.md", "HANDOFF.md", "spec-gaps.md", "steps"].includes(parts[1])) return true;
    if (parts.length === 3 && parts[1] === "steps" && parts[2].endsWith(".md")) return true;
  }
  const adr = beneath(file, decisions);
  if (adr !== null && !adr.includes("/") && /^\d{4}-.*\.md$/.test(adr)) return true;
  return specDirs.some(dir => {
    const rel = beneath(file, dir);
    return rel !== null && (rel.endsWith(".md") || couldBeDirectory(knownFileLink));
  });
}

/** Materialize regular files from a captured commit into a private, disposable read tree. */
export function withApprovalReadTree<T>(root: string, commit: string, use: (tree: string) => T, validationPaths?: ValidationPaths): T {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-approval-"));
  try {
    const entries = run("git", ["ls-tree", "-rlz", "--full-tree", commit], { cwd: root, binary: true })
      .toString("utf8").split("\0").filter(Boolean).map(line => {
        const tab = line.indexOf("\t"), fields = line.slice(0, tab).split(" ");
        return { mode: fields[0], oid: fields[2], size: Number(fields.at(-1)), file: line.slice(tab + 1) };
      });
    const regular = new Set(entries.filter(e => e.mode === "100644" || e.mode === "100755").map(e => e.file));
    for (const entry of entries) {
      if (entry.mode === "100644" || entry.mode === "100755") continue;
      let knownFileLink = false;
      if (entry.mode === "120000") {
        const target = run("git", ["cat-file", "blob", entry.oid], { cwd: root, binary: true }).toString("utf8");
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), target));
        knownFileLink = !path.posix.isAbsolute(target) && !resolved.startsWith("../") && regular.has(resolved);
      }
      if (validationPaths && relevant(entry.file, knownFileLink, validationPaths)) {
        throw new PlanStateError(`Unsupported committed approval input at ${entry.file} (mode ${entry.mode}); replace it with regular files or directories and retry.`);
      }
    }
    const files = entries.filter(e => e.mode === "100644" || e.mode === "100755");
    // Bound aggregate batch memory even for repositories with large unrelated trees.
    for (let first = 0; first < files.length;) {
      let last = first, bytes = 0;
      while (last < files.length && (last === first || bytes + files[last].size <= 32 * 1024 * 1024)) {
        if (!Number.isSafeInteger(files[last].size) || files[last].size < 0) throw new Error("Invalid approval snapshot size.");
        bytes += files[last++].size;
      }
      const batch = files.slice(first, last);
      const data = run("git", ["cat-file", "--batch"], { cwd: root, binary: true, input: Buffer.from(batch.map(e => e.oid).join("\n") + "\n"), maxBuffer: bytes + batch.length * 128 + 1024 });
      let offset = 0;
      for (const entry of batch) {
        if (!entry.file || entry.file.includes("\\") || entry.file.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Unsafe path in approval snapshot.");
        const end = data.indexOf(10, offset), header = data.subarray(offset, end).toString("ascii");
        const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
        if (end < 0 || !match || match[1] !== entry.oid) throw new Error("Invalid approval snapshot blob.");
        const size = Number(match[2]); offset = end + 1;
        if (size !== entry.size || offset + size >= data.length || data[offset + size] !== 10) throw new Error("Truncated approval snapshot blob.");
        const target = path.join(tree, entry.file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data.subarray(offset, offset + size));
        offset += size + 1;
      }
      first = last;
    }
    return use(tree);
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
}
