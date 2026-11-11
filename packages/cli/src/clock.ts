import { randomBytes } from "node:crypto";

/** The one injectable clock and random source (`architecture/reference-cli` §1), so tests are reproducible. */
export interface Clock {
  now(): Date;
  /** A number in [0, 1). */
  random(): number;
}

const real: Clock = { now: () => new Date(), random: () => randomBytes(4).readUInt32BE(0) / 2 ** 32 };
let current: Clock = real;

/** Replace parts of the clock (tests); `null` restores the real one. */
export function setClock(c: Partial<Clock> | null): void {
  current = c === null ? real : { ...real, ...c };
}

export const clock: Clock = { now: () => current.now(), random: () => current.random() };

/** `n` lowercase hex digits from the injectable random source. */
export function randomHex(n: number): string {
  let out = "";
  while (out.length < n) out += Math.floor(clock.random() * 16).toString(16);
  return out;
}
