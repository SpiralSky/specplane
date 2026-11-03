import { Ajv, type Options, type ValidateFunction } from 'ajv';

const defaultOptions: Options = {};
const instances = new WeakMap<Options, Ajv>();

/** Preserve the caller's AJV options and compile only when validation is needed. */
export function lazyValidator(schema: object, options: Options = defaultOptions) {
  let compiled: ValidateFunction | undefined;
  const validate = (data: unknown): boolean => {
    if (!compiled) {
      let ajv = instances.get(options);
      if (!ajv) {
        ajv = new Ajv(options);
        instances.set(options, ajv);
      }
      compiled = ajv.compile(schema);
    }
    return compiled(data) as boolean;
  };
  return Object.defineProperty(validate, 'errors', {
    get: () => compiled?.errors,
  }) as typeof validate & Pick<ValidateFunction, 'errors'>;
}
