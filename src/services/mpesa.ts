/**
 * Direct withdraw-to-M-Pesa via the bitcoin.co.ke Lightning bridge.
 *
 * The bridge exposes an LNURL-pay endpoint keyed by a Kenyan phone number:
 *
 *   GET https://bitcoin.co.ke/.well-known/lnurlp/{phone}            -> payRequest range
 *   GET https://bitcoin.co.ke/.well-known/lnurlp/{phone}?amount={msat}
 *   GET https://bitcoin.co.ke/.well-known/lnurlp/{phone}?amount={kes}&currency=KES
 *
 * The returned Bolt11 invoice is paid by the wallet the normal way
 * (services/wallet.parseInput -> prepareSend -> send), so the only thing
 * here is the bridge fetches and Kenyan number normalisation.
 */

const BRIDGE = "https://bitcoin.co.ke";

/** A phone number the bridge accepts, e.g. "254717252303". */
export type MpesaPhone = string;

export interface MpesaCapability {
  phone: MpesaPhone;
  /** Smallest sendable amount, in sats (ceil of minSendable msat). */
  minSats: bigint;
  /** Largest sendable amount, in sats (floor of maxSendable msat). */
  maxSats: bigint;
}

export interface MpesaSuccessAction {
  url: string;
  description?: string;
}

export interface MpesaInvoice {
  /** Bolt11 invoice string to pay. */
  pr: string;
  successAction: MpesaSuccessAction | null;
  /** Present when the invoice was requested in KES. */
  convertedKes?: number;
}

/**
 * Normalise a Kenyan M-Pesa number to international form without the "+".
 * Accepts 0717252303, +254717252303, 254717252303, 717252303.
 * Returns null for non-Kenyan or malformed numbers (the bridge is M-Pesa only).
 */
export function normalizeMpesaPhone(raw: string): MpesaPhone | null {
  const digits = raw.replace(/[^\d]/g, "");
  let local: string;
  if (digits.startsWith("254")) local = digits.slice(3);
  else if (digits.startsWith("0")) local = digits.slice(1);
  else local = digits;
  if (!/^([17]\d{8})$/.test(local)) return null;
  return `254${local}`;
}

/** Display form for a normalised number: +254 717 252303. */
export function formatMpesaPhone(phone: MpesaPhone): string {
  const m = /^254([17]\d)(\d{3})(\d{4})$/.exec(phone);
  if (!m) return phone;
  return `+254 ${m[1]}${m[2]} ${m[3]}`;
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the bridge whether it serves a number, and the sats range it accepts.
 * Returns null for a 404 (unsupported number) so the UI can say "not covered".
 */
export async function checkMpesaNumber(phone: MpesaPhone): Promise<MpesaCapability> {
  const res = await fetchJson(`${BRIDGE}/.well-known/lnurlp/${phone}`);
  if (res.status === 404) throw new MpesaUnsupported();
  if (!res.ok) throw new Error(`Bridge returned ${res.status}`);
  const data = (await res.json()) as { tag?: string; minSendable: number; maxSendable: number };
  if (data.tag !== "payRequest") throw new Error("Unexpected response from the bridge.");
  return {
    phone,
    minSats: (BigInt(data.minSendable) + 999n) / 1000n,
    maxSats: BigInt(data.maxSendable) / 1000n,
  };
}

export class MpesaUnsupported extends Error {
  constructor() {
    super("This number isn't on M-Pesa, or the bridge doesn't cover it yet.");
    this.name = "MpesaUnsupported";
  }
}

/** Request an invoice for a specific amount, in sats. */
export function requestMpesaInvoiceSats(phone: MpesaPhone, sats: bigint): Promise<MpesaInvoice> {
  return requestInvoice(`${BRIDGE}/.well-known/lnurlp/${phone}?amount=${sats * 1000n}`);
}

/** Request an invoice for a specific KES amount (whole shillings). */
export function requestMpesaInvoiceKes(phone: MpesaPhone, kes: number): Promise<MpesaInvoice> {
  return requestInvoice(`${BRIDGE}/.well-known/lnurlp/${phone}?amount=${kes}&currency=KES`);
}

async function requestInvoice(url: string): Promise<MpesaInvoice> {
  const res = await fetchJson(url);
  if (!res.ok) {
    let detail = `Bridge returned ${res.status}`;
    try {
      const body = (await res.json()) as { reason?: string; detail?: string; error?: string };
      detail = body.reason ?? body.detail ?? body.error ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  const data = (await res.json()) as {
    pr: string;
    successAction?: { tag: string; url?: string; description?: string } | null;
    converted?: number;
  };
  if (!data.pr) throw new Error("The bridge didn't return an invoice.");
  const sa = data.successAction;
  return {
    pr: data.pr,
    successAction: sa && sa.tag === "url" && sa.url ? { url: sa.url, description: sa.description } : null,
    convertedKes: typeof data.converted === "number" ? data.converted : undefined,
  };
}
