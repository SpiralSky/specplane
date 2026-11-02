import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../git/exec.js";

/** Materialize regular files from a captured commit into a private, disposable read tree. */
export function withApprovalReadTree<T>(root: string, commit: string, use: (tree: string) => T, validationRoots: string[] = []): T {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-approval-"));
  try {
    const entries = run("git", ["ls-tree", "-rlz", "--full-tree", commit], { cwd: root, binary: true })
      .toString("utf8").split("\0").filter(Boolean).map(line => {
        const tab = line.indexOf("\t"), fields = line.slice(0, tab).split(" ");
        return { mode: fields[0], oid: fields[2], size: Number(fields.at(-1)), file: line.slice(tab + 1) };
      });
    const roots = validationRoots.map(p => path.posix.normalize(p.replaceAll("\\", "/")).replace(/\/$/, ""));
    for (const entry of entries) {
      if (entry.mode === "100644" || entry.mode === "100755") continue;
      if (roots.some(p => p === "." || entry.file === p || entry.file.startsWith(`${p}/`) || p.startsWith(`${entry.file}/`))) {
        throw new Error(`Unsupported committed approval input at ${entry.file} (mode ${entry.mode}).`);
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
