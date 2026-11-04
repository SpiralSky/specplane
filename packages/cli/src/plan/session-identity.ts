import { createHash } from "node:crypto";

/** Deterministic UUIDv5 (DNS namespace) for a plan step, so a restarted conductor resumes instead of launching twice. */
export function sessionIdFor(plan: string, step: number): string {
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(plan) || !Number.isSafeInteger(step) || step < 1) {
    throw new Error("A valid plan ID and positive integer step are required for session identity.");
  }
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const hash = createHash("sha1").update(namespace).update(`specplane/${plan}/${step}`).digest().subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
