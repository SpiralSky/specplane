/**
 * The one place the `yaml` library (eemeli, YAML 1.2) is configured (`architecture/reference-cli` §1).
 * Files are read as JSON-compatible YAML: the core schema, string keys only, no duplicate keys, and
 * timestamps stay strings. Rendering uses the document API so a single entry can be written in flow or
 * block style without touching the rest of a file.
 */
import { Document, isScalar, parseDocument, visit } from "yaml";

/** Parse JSON-compatible YAML; throws an Error whose first line says what is wrong. Empty input gives `null`. */
export function parseYaml(text: string): unknown {
  const doc = parseDocument(text, { schema: "core", uniqueKeys: true, version: "1.2" });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  visit(doc, {
    Pair(_, pair) {
      if (!(isScalar(pair.key) && typeof pair.key.value === "string")) throw new Error("mapping keys must be strings");
    },
  });
  return doc.toJS({ maxAliasCount: -1 });
}

export interface DumpOptions {
  /** Write sequences whose items are all scalars in flow style (`[a, b]`). */
  flowScalarLists?: boolean;
}

/** Render a value as YAML text ending in a newline: block style, no line folding, single quotes where quoting is needed. */
export function dumpYaml(value: unknown, opts: DumpOptions = {}): string {
  const doc = new Document(value, { aliasDuplicateObjects: false });
  if (opts.flowScalarLists) {
    visit(doc, {
      Seq(_, seq) {
        if (seq.items.every((i) => isScalar(i))) seq.flow = true;
      },
    });
  }
  return doc.toString({ lineWidth: 0, singleQuote: true, flowCollectionPadding: false, indent: 2 });
}

