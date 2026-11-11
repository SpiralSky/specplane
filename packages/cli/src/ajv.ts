/** Shared Ajv instance factory for the JSON records the CLI validates (requests, actions). */
import { Ajv } from "ajv";
import addFormatsModule from "ajv-formats";

// ajv-formats is CJS; under NodeNext its default import is typed as the module namespace.
const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;

export function createAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  return ajv;
}
