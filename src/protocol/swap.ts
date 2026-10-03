/**
 * pontmore/swap@1 on the PIP-02 version 2 kernel: root parsing and
 * deterministic reconstruction.
 *
 * State is derived only by replaying validated signed events along their
 * `prev` links. Relay order and timestamps never order the chain; a second
 * valid child of the same predecessor freezes the swap as forked.
 */
import { verifyEvent, type Event } from "nostr-tools/pure";

import { DISPUTE_CLASSES, KIND, PIP02_VERSION, SWAP_PROFILE } from "./constants";
import { sameCommitment } from "../lib/keys";
import { isDecimalAmount } from "../lib/money";

export type Direction = "fiat_to_btc" | "btc_to_fiat";

export interface SwapTerms {
  direction: Direction;
  fiat: { currency: string; amount: string };
  bitcoin: { amount: string; unit: "sat"; network: string };
  payment_channel: string;
  deadlines: { fiat_pay_by: number; fiat_confirm_by: number };
}

export interface CommitmentObject {
  algorithm: string;
  digest: string;
}

export interface SwapRoot {
  id: string;
  event: Event;
  createdAt: number;
  proposer: string;
  agent: string;
  customer: string;
  escrow: string;
  resolver: string;
  descriptorId: string;
  descriptorAddress: string;
  terms: SwapTerms;
  expiresAt: number;
  commitments: Record<string, CommitmentObject>;
}

export type SwapStatus =
  | "proposed"
  | "accepted"
  | "secured"
  | "fiat_sent"
  | "fiat_confirmed"
  | "settlement_authorized"
  | "refund_authorized"
  | "settled"
  | "refunded"
  | "declined"
  | "cancelled"
  | "expired";

export const TERMINAL: ReadonlySet<SwapStatus> = new Set(["settled", "refunded", "declined", "cancelled", "expired"]);

export interface AppliedAction {
  id: string;
  action: string;
  signer: string;
  createdAt: number;
  data?: Record<string, unknown>;
}

export interface SwapState {
  root: SwapRoot;
  status: SwapStatus;
  disputed: boolean;
  dispute?: { by: string; class?: string; at: number; preStatus: SwapStatus };
  resolution?: { effect: string; at: number };
  forked: boolean;
  forkIds: string[];
  tip: string;
  chain: AppliedAction[];
  rejected: { id: string; reason: string }[];
  paymentReference?: unknown;
}

export class ProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isTs = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

// -- roles --------------------------------------------------------------------

export function fiatSender(root: SwapRoot): string {
  return root.terms.direction === "fiat_to_btc" ? root.customer : root.agent;
}

export function fiatReceiver(root: SwapRoot): string {
  return root.terms.direction === "fiat_to_btc" ? root.agent : root.customer;
}

/** Bitcoin provider equals the fiat receiver in both directions. */
export const bitcoinProvider = fiatReceiver;
export const bitcoinRecipient = fiatSender;

export function counterpartyOf(root: SwapRoot, pk: string): string {
  return pk === root.agent ? root.customer : root.agent;
}

// -- terms --------------------------------------------------------------------

export function validateTerms(terms: unknown, rootExpiresAt: number): SwapTerms {
  if (!isObj(terms)) throw new ProtocolError("terms_invalid", "Terms must be an object");
  const { direction, fiat, bitcoin, payment_channel, deadlines } = terms;
  if (direction !== "fiat_to_btc" && direction !== "btc_to_fiat")
    throw new ProtocolError("terms_invalid", "Unknown direction");
  if (!isObj(fiat) || typeof fiat.currency !== "string" || !/^[A-Z]{3}$/.test(fiat.currency))
    throw new ProtocolError("terms_invalid", "Fiat currency must be ISO 4217");
  if (typeof fiat.amount !== "string" || !isDecimalAmount(fiat.amount) || Number(fiat.amount) <= 0)
    throw new ProtocolError("terms_invalid", "Fiat amount must be a positive decimal string");
  if (!isObj(bitcoin) || typeof bitcoin.amount !== "string" || !/^[1-9]\d*$/.test(bitcoin.amount))
    throw new ProtocolError("terms_invalid", "Bitcoin amount must be a positive integer string");
  if (bitcoin.unit !== "sat") throw new ProtocolError("terms_invalid", "Bitcoin unit must be sat");
  if (typeof bitcoin.network !== "string" || !bitcoin.network)
    throw new ProtocolError("terms_invalid", "Bitcoin network required");
  if (typeof payment_channel !== "string" || !/@[1-9]\d*$/.test(payment_channel))
    throw new ProtocolError("terms_invalid", "Payment channel must be versioned");
  if (!isObj(deadlines) || !isTs(deadlines.fiat_pay_by) || !isTs(deadlines.fiat_confirm_by))
    throw new ProtocolError("terms_invalid", "Deadlines required");
  if (!(rootExpiresAt < deadlines.fiat_pay_by && deadlines.fiat_pay_by < deadlines.fiat_confirm_by))
    throw new ProtocolError("terms_invalid", "Deadlines must satisfy expires_at < fiat_pay_by < fiat_confirm_by");
  return {
    direction,
    fiat: { currency: fiat.currency, amount: fiat.amount },
    bitcoin: { amount: bitcoin.amount, unit: "sat", network: bitcoin.network },
    payment_channel,
    deadlines: { fiat_pay_by: deadlines.fiat_pay_by, fiat_confirm_by: deadlines.fiat_confirm_by },
  };
}

// -- root ---------------------------------------------------------------------

export function parseRoot(event: Event, opts: { verify?: boolean } = {}): SwapRoot {
  if (event.kind !== KIND.root) throw new ProtocolError("root_kind", "Not a coordination root");
  if (opts.verify !== false && !verifyEvent(event)) throw new ProtocolError("signature", "Invalid root signature");

  let content: unknown;
  try {
    content = JSON.parse(event.content);
  } catch {
    throw new ProtocolError("root_content", "Root content is not JSON");
  }
  if (!isObj(content)) throw new ProtocolError("root_content", "Root content must be an object");
  if (content.version !== PIP02_VERSION) throw new ProtocolError("version", "Unsupported PIP-02 version");
  if (content.profile !== SWAP_PROFILE) throw new ProtocolError("profile", "Unsupported profile");
  if (!isTs(content.expires_at)) throw new ProtocolError("root_content", "expires_at required");

  const roles = new Map<string, string[]>();
  for (const tag of event.tags) {
    if (tag[0] !== "p" || !tag[3]) continue;
    if (!HEX64.test(tag[1] ?? "")) throw new ProtocolError("roles", "Invalid participant pubkey");
    roles.set(tag[3], [...(roles.get(tag[3]) ?? []), tag[1]]);
  }
  const one = (role: string) => {
    const pks = roles.get(role) ?? [];
    if (pks.length !== 1) throw new ProtocolError("roles", `Root must bind exactly one ${role}`);
    return pks[0];
  };
  const agent = one("swap/agent");
  const customer = one("swap/customer");
  const escrow = one("core/escrow");
  // swap@1 permits core/open_dispute, so a resolver is mandatory.
  const resolver = one("core/resolver");
  const all = [agent, customer, escrow, resolver];
  if (new Set(all).size !== all.length)
    throw new ProtocolError("roles", "Profile does not permit one pubkey to hold several roles");
  if (event.pubkey !== agent && event.pubkey !== customer)
    throw new ProtocolError("roles", "Root signer must be an application participant");

  const descE = event.tags.filter((t) => t[0] === "e" && t[3] === "escrow-version");
  const descA = event.tags.filter((t) => t[0] === "a" && t[3] === "escrow");
  if (descE.length !== 1 || !HEX64.test(descE[0][1] ?? ""))
    throw new ProtocolError("escrow_binding", "Root must bind one exact escrow descriptor");
  if (descA.length !== 1 || !/^30361:[0-9a-f]{64}:.+$/.test(descA[0][1] ?? ""))
    throw new ProtocolError("escrow_binding", "Root must bind one escrow descriptor address");

  const commitments: Record<string, CommitmentObject> = {};
  if (content.commitments !== undefined) {
    if (!isObj(content.commitments)) throw new ProtocolError("commitments", "commitments must be an object");
    for (const [key, value] of Object.entries(content.commitments)) {
      if (key !== "quote" && key !== "private_terms")
        throw new ProtocolError("commitments", `Commitment key ${key} not permitted by profile`);
      if (!isObj(value) || value.algorithm !== "sha256-bytes@1" || typeof value.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.digest))
        throw new ProtocolError("commitments", "Commitments must use sha256-bytes@1");
      commitments[key] = { algorithm: value.algorithm, digest: value.digest };
    }
  }

  return {
    id: event.id,
    event,
    createdAt: event.created_at,
    proposer: event.pubkey,
    agent,
    customer,
    escrow,
    resolver,
    descriptorId: descE[0][1],
    descriptorAddress: descA[0][1],
    terms: validateTerms(content.terms, content.expires_at),
    expiresAt: content.expires_at,
    commitments,
  };
}

// -- actions ------------------------------------------------------------------

interface ParsedAction {
  event: Event;
  prev: string;
  action: string;
  data?: Record<string, unknown>;
}

function parseAction(event: Event, rootId: string, verify: boolean): ParsedAction | string {
  if (event.kind !== KIND.action) return "not an action";
  if (verify && !verifyEvent(event)) return "invalid signature";
  const roots = event.tags.filter((t) => t[0] === "e" && t[3] === "root");
  const prevs = event.tags.filter((t) => t[0] === "e" && t[3] === "prev");
  if (roots.length !== 1 || prevs.length !== 1) return "must reference exactly one root and one prev";
  if (roots[0][1] !== rootId) return "different coordination";
  let content: unknown;
  try {
    content = JSON.parse(event.content);
  } catch {
    return "content is not JSON";
  }
  if (!isObj(content) || content.version !== PIP02_VERSION || typeof content.action !== "string")
    return "invalid action content";
  if (content.data !== undefined && !isObj(content.data)) return "data must be an object";
  return { event, prev: prevs[0][1], action: content.action, data: content.data as Record<string, unknown> | undefined };
}

function validEvidence(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.every(
      (r) => isObj(r) && ["event", "commitment", "opaque"].includes(r.type as string) && typeof r.value === "string",
    )
  );
}

function kernelDataOk(data: Record<string, unknown> | undefined, allowed: string[]): boolean {
  if (!data) return true;
  if (!Object.keys(data).every((k) => k === "evidence" || allowed.includes(k))) return false;
  return validEvidence(data.evidence);
}

function validPaymentReference(ref: unknown): boolean {
  if (typeof ref === "string") return /^[A-Za-z0-9._:-]{1,128}$/.test(ref);
  return isObj(ref) && ref.algorithm === "sha256-bytes@1" && typeof ref.digest === "string" && /^sha256:[0-9a-f]{64}$/.test(ref.digest);
}

function samePaymentReference(a: unknown, b: unknown): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return sameCommitment(a, b);
}

const SECURED_OR_LATER: ReadonlySet<SwapStatus> = new Set([
  "secured",
  "fiat_sent",
  "fiat_confirmed",
  "settlement_authorized",
  "refund_authorized",
]);

type Step = { ok: true; next: SwapState } | { ok: false; reason: string };

function step(state: SwapState, a: ParsedAction): Step {
  const { root } = state;
  const signer = a.event.pubkey;
  const t = a.event.created_at;
  const fail = (reason: string): Step => ({ ok: false, reason });
  const to = (status: SwapStatus, extra: Partial<SwapState> = {}): Step => ({
    ok: true,
    next: { ...state, ...extra, status },
  });

  if (TERMINAL.has(state.status)) return fail("coordination is terminal");

  const isParticipant = signer === root.agent || signer === root.customer;
  const nonProposer = root.proposer === root.agent ? root.customer : root.agent;
  const { fiat_pay_by, fiat_confirm_by } = root.terms.deadlines;

  if (state.disputed && a.action !== "core/resolve_dispute") return fail("disputed: ordinary progress frozen");

  switch (a.action) {
    case "core/accept":
      if (!kernelDataOk(a.data, [])) return fail("invalid data");
      if (signer !== nonProposer) return fail("only the non-proposing participant accepts");
      if (state.status !== "proposed") return fail("not awaiting acceptance");
      if (t >= root.expiresAt) return fail("accepted after expires_at");
      return to("accepted");

    case "core/decline":
      if (!kernelDataOk(a.data, [])) return fail("invalid data");
      if (signer !== nonProposer) return fail("only the non-proposing participant declines");
      if (state.status !== "proposed") return fail("not awaiting acceptance");
      return to("declined");

    case "core/cancel":
      if (!kernelDataOk(a.data, [])) return fail("invalid data");
      if (state.status === "proposed" && signer === root.proposer) return to("cancelled");
      if (state.status === "accepted" && isParticipant) return to("cancelled");
      return fail("cancel not permitted now");

    case "core/expire":
      if (!kernelDataOk(a.data, [])) return fail("invalid data");
      if (!isParticipant) return fail("only participants record expiry");
      if (state.status !== "proposed") return fail("only an unaccepted swap expires");
      if (t < root.expiresAt) return fail("not yet expired");
      return to("expired");

    case "core/secure":
      if (!kernelDataOk(a.data, [])) return fail("invalid data");
      if (signer !== root.escrow) return fail("only the bound escrow secures");
      if (state.status !== "accepted") return fail("not accepted");
      return to("secured");

    case "swap/fiat_sent": {
      if (signer !== fiatSender(root)) return fail("only the fiat sender records fiat_sent");
      if (state.status !== "secured") return fail("not secured");
      if (t >= fiat_pay_by) return fail("after fiat_pay_by");
      const ref = a.data?.payment_reference;
      if (!validPaymentReference(ref)) return fail("invalid payment_reference");
      return to("fiat_sent", { paymentReference: ref });
    }

    case "swap/fiat_confirmed": {
      if (signer !== fiatReceiver(root)) return fail("only the fiat receiver confirms");
      if (state.status !== "fiat_sent") return fail("no fiat_sent to confirm");
      if (t >= fiat_confirm_by) return fail("after fiat_confirm_by");
      if (!samePaymentReference(a.data?.payment_reference, state.paymentReference))
        return fail("payment_reference mismatch");
      return to("fiat_confirmed");
    }

    case "core/authorize_settlement":
      if (!kernelDataOk(a.data, [])) return fail("invalid data");
      if (signer !== fiatReceiver(root)) return fail("only the fiat receiver authorizes settlement");
      if (state.status !== "fiat_confirmed") return fail("fiat not confirmed");
      return to("settlement_authorized");

    case "core/settle":
      if (!kernelDataOk(a.data, [])) return fail("invalid data");
      if (signer !== root.escrow) return fail("only the bound escrow settles");
      if (state.status !== "settlement_authorized") return fail("settlement not authorized");
      return to("settled");

    case "core/authorize_refund":
      if (!kernelDataOk(a.data, [])) return fail("invalid data");
      if (signer !== bitcoinProvider(root)) return fail("only the bitcoin provider authorizes refund");
      if (state.status !== "secured") return fail("refund only from secured without fiat_sent");
      if (t < fiat_pay_by) return fail("fiat_pay_by has not elapsed");
      return to("refund_authorized");

    case "core/refund":
      if (!kernelDataOk(a.data, [])) return fail("invalid data");
      if (signer !== root.escrow) return fail("only the bound escrow refunds");
      if (state.status !== "refund_authorized") return fail("refund not authorized");
      return to("refunded");

    case "core/open_dispute": {
      if (!kernelDataOk(a.data, ["class"])) return fail("invalid data");
      if (!isParticipant) return fail("only participants open disputes");
      if (state.status === "proposed") return fail("not accepted");
      const cls = a.data?.class;
      if (cls !== undefined && !(DISPUTE_CLASSES as readonly string[]).includes(cls as string))
        return fail("unknown dispute class");
      return {
        ok: true,
        next: {
          ...state,
          disputed: true,
          dispute: { by: signer, class: cls as string | undefined, at: t, preStatus: state.status },
        },
      };
    }

    case "core/resolve_dispute": {
      if (!kernelDataOk(a.data, ["policy", "effect"])) return fail("invalid data");
      if (signer !== root.resolver) return fail("only the bound resolver resolves");
      if (!state.disputed || !state.dispute) return fail("not disputed");
      if (typeof a.data?.policy !== "string" || !a.data.policy) return fail("policy required");
      const effect = a.data.effect;
      const base = { ...state, disputed: false, resolution: { effect: String(effect), at: t } };
      const pre = state.dispute.preStatus;
      switch (effect) {
        case "resume":
          return { ok: true, next: { ...base, status: pre } };
        case "authorize_settlement":
          if (!SECURED_OR_LATER.has(pre)) return fail("no settlement before secure");
          return { ok: true, next: { ...base, status: "settlement_authorized" } };
        case "authorize_refund":
          if (!SECURED_OR_LATER.has(pre)) return fail("no refund before secure");
          return { ok: true, next: { ...base, status: "refund_authorized" } };
        case "cancel":
          return { ok: true, next: { ...base, status: "cancelled" } };
        default:
          return fail("unknown resolution effect");
      }
    }

    default:
      if (a.action.startsWith("core/")) return fail("unknown kernel action");
      return fail("action not defined by pontmore/swap@1");
  }
}

/**
 * Replay a root and any set of candidate action events (unordered, possibly
 * duplicated or foreign) into the derived swap state.
 */
export function reconstruct(root: SwapRoot, events: Iterable<Event>, opts: { verify?: boolean } = {}): SwapState {
  const verify = opts.verify !== false;
  let state: SwapState = {
    root,
    status: "proposed",
    disputed: false,
    forked: false,
    forkIds: [],
    tip: root.id,
    chain: [],
    rejected: [],
  };

  const byPrev = new Map<string, ParsedAction[]>();
  const seen = new Set<string>();
  for (const ev of events) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    const parsed = parseAction(ev, root.id, verify);
    if (typeof parsed === "string") {
      if (parsed !== "different coordination") state.rejected.push({ id: ev.id, reason: parsed });
      continue;
    }
    byPrev.set(parsed.prev, [...(byPrev.get(parsed.prev) ?? []), parsed]);
  }

  for (;;) {
    const children = byPrev.get(state.tip) ?? [];
    const valid: { a: ParsedAction; next: SwapState }[] = [];
    for (const child of children) {
      const result = step(state, child);
      if (result.ok) valid.push({ a: child, next: result.next });
      else state.rejected.push({ id: child.event.id, reason: result.reason });
    }
    if (valid.length === 0) break;
    if (valid.length > 1) {
      // PIP-02 fork: keep both as evidence, freeze, pick no winner.
      state = { ...state, forked: true, forkIds: valid.map((v) => v.a.event.id) };
      break;
    }
    const { a, next } = valid[0];
    state = {
      ...next,
      tip: a.event.id,
      chain: [
        ...state.chain,
        { id: a.event.id, action: a.action, signer: a.event.pubkey, createdAt: a.event.created_at, data: a.data },
      ],
      rejected: state.rejected,
    };
  }
  return state;
}

export function isTerminal(state: SwapState): boolean {
  return TERMINAL.has(state.status);
}

/** True when an unaccepted root has passed its acceptance deadline. */
export function isLapsed(state: SwapState, now: number): boolean {
  return state.status === "proposed" && now >= state.root.expiresAt;
}

export function findAction(state: SwapState, action: string): AppliedAction | undefined {
  return state.chain.find((a) => a.action === action);
}
