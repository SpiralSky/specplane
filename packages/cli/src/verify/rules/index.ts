import { rules as cites } from "./cites.js";
import { rules as config } from "./config.js";
import { rules as notes } from "./notes.js";
import { rules as permissions } from "./permissions.js";
import { rules as plans } from "./plans.js";
import { rules as requirements } from "./requirements.js";
import { rules as specFormat } from "./spec-format.js";
import { rules as status } from "./status.js";
import { rules as tests } from "./tests.js";
import type { Rule } from "./types.js";

/**
 * Every rule, in run order (`architecture/reference-cli` §6.1). `status` runs before `notes`, which reads the store
 * the status rule has loaded. The `harness` family joins when that feature exists.
 */
export const RULES: Rule[] = [...config, ...requirements, ...specFormat, ...cites, ...plans, ...status, ...notes, ...tests, ...permissions];
