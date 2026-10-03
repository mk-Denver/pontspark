/**
 * Exact money arithmetic.
 *
 * pontmore/swap@1 carries fiat amounts as base-10 decimal strings and bitcoin
 * as integer sat strings, so both sides of a swap must derive the same numbers
 * from the same inputs. Everything here works in integer minor units (1/100)
 * with BigInt; floats are only used for display.
 */

export const SATS_PER_BTC = 100_000_000n;
const DECIMAL = /^(0|[1-9]\d*)(\.\d{1,2})?$/;

export function isDecimalAmount(value: string): boolean {
  return DECIMAL.test(value);
}

/** "1000" -> 100000n, "10.5" -> 1050n. Throws on anything else. */
export function toMinor(value: string): bigint {
  if (!DECIMAL.test(value)) throw new Error(`Invalid decimal amount: ${value}`);
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
}

/** Canonical decimal string: integers stay integers, otherwise two decimals. */
export function fromMinor(minor: bigint): string {
  if (minor < 0n) throw new Error("Negative amount");
  const whole = minor / 100n;
  const frac = minor % 100n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0")}`;
}

/** Normalise user input ("1,000.5" -> "1000.5") or return null. */
export function parseFiatInput(raw: string): string | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!cleaned || !DECIMAL.test(cleaned)) return null;
  return fromMinor(toMinor(cleaned));
}

/** Sats for a fiat amount at an exact price (fiat per BTC). Rounds down. */
export function satsForFiat(fiatAmount: string, pricePerBtc: string): bigint {
  const price = toMinor(pricePerBtc);
  if (price <= 0n) throw new Error("Price must be positive");
  return (toMinor(fiatAmount) * SATS_PER_BTC) / price;
}

/** Fiat value of sats at a price, rounded down to minor units. */
export function fiatForSats(sats: bigint, pricePerBtc: string): string {
  return fromMinor((sats * toMinor(pricePerBtc)) / SATS_PER_BTC);
}

/** Apply a percentage spread to a market price; whole fiat units per BTC. */
export function priceWithSpread(marketPerBtc: number, spreadPct: number): string {
  const value = Math.round(marketPerBtc * (1 + spreadPct / 100));
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid market price");
  return String(value);
}

export function compareDecimal(a: string, b: string): number {
  const x = toMinor(a);
  const y = toMinor(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

// -- display -----------------------------------------------------------------

function groupDigits(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatSats(sats: bigint | number | string): string {
  const n = BigInt(typeof sats === "number" ? Math.trunc(sats) : sats);
  return `${groupDigits(n.toString())} sats`;
}

export function formatSatsShort(sats: bigint | number | string): string {
  return groupDigits(BigInt(typeof sats === "number" ? Math.trunc(sats) : sats).toString());
}

export function formatFiat(amount: string | number, code: string, decimals = 2): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return `${code} —`;
  const fixed = n.toFixed(decimals);
  const [whole, frac] = fixed.split(".");
  return `${code} ${groupDigits(whole)}${frac ? "." + frac : ""}`;
}

/** Display a decimal string without float rounding surprises. */
export function formatDecimal(amount: string, decimals = 0): string {
  const [whole, frac = ""] = amount.split(".");
  const f = decimals > 0 ? (frac + "0".repeat(decimals)).slice(0, decimals) : frac.replace(/0+$/, "");
  return groupDigits(whole) + (f ? "." + f : "");
}

export function satsToFiatNumber(sats: bigint | number, marketPerBtc: number | undefined): number | undefined {
  if (marketPerBtc === undefined) return undefined;
  return (Number(sats) / 1e8) * marketPerBtc;
}

/**
 * Largest 1-2-5 step at or below `amount`. The sell side's max is capped by
 * the agent's balance; publishing the exact figure would reveal the balance.
 */
export function coarseFloor(amount: string): string {
  const n = Math.floor(Number(amount));
  if (!(n >= 1)) return "0";
  const mag = 10 ** Math.floor(Math.log10(n));
  const step = [5, 2, 1].find((m) => m * mag <= n)!;
  return String(step * mag);
}
