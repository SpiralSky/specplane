/** Topic ids every documentation bundle must contain (`architecture/reference-cli` §12.5). */
export const REQUIRED_TOPIC_IDS = [
  "getting-started", "concepts", "specification-format", "plans", "configuration", "commands", "permissions", "verification", "harnesses",
] as const;

/** Marker ids of the mandatory notes; each appears in the docs as `<!-- note: <id> -->` followed by its paragraph. */
export const MANDATORY_NOTES = ["group-approval", "llm-allow-approves", "audit-retention", "private-logs", "harness-support"] as const;

/** Size limit of the always-loaded essentials file (`steering` R23), checked by the build and in tests. */
export const ESSENTIALS_LIMIT_BYTES = 8192;
