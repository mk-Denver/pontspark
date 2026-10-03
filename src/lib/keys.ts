/**
 * Every secret in the app comes from the one wallet phrase.
 *
 * Following the Minmo self-custodial identity research, Nostr keys are derived
 * with NIP-06 from the same BIP39 phrase that seeds the Breez Spark wallet
 * (Spark uses an unrelated derivation tree), so one backup restores funds,
 * identity and agent authority keys together.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { getPublicKey } from "nostr-tools/pure";
import { privateKeyFromSeedWords } from "nostr-tools/nip06";

export interface KeyPair {
  sk: Uint8Array;
  pk: string;
}

export interface KeyRing {
  /** Public identity: profile, agent definition, swap participant. */
  identity: KeyPair;
  /** Agent mode: publishes the escrow descriptor and core/secure|settle|refund. */
  escrow: KeyPair;
  /** Agent mode: bound as core/resolver for the agent's swaps. */
  resolver: KeyPair;
}

const ACCOUNT = { identity: 0, escrow: 1, resolver: 2 } as const;

export function newMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

export function normaliseMnemonic(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).join(" ");
}

export function isValidMnemonic(input: string): boolean {
  return validateMnemonic(normaliseMnemonic(input), wordlist);
}

export function isMnemonicWord(word: string): boolean {
  return wordlist.includes(word.trim().toLowerCase());
}

export function mnemonicWordSuggestions(prefix: string, limit = 4): string[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  return wordlist.filter((w) => w.startsWith(p)).slice(0, limit);
}

function account(mnemonic: string, index: number): KeyPair {
  const sk = privateKeyFromSeedWords(mnemonic, undefined, index);
  return { sk, pk: getPublicKey(sk) };
}

export function deriveKeyRing(mnemonic: string): KeyRing {
  const m = normaliseMnemonic(mnemonic);
  return {
    identity: account(m, ACCOUNT.identity),
    escrow: account(m, ACCOUNT.escrow),
    resolver: account(m, ACCOUNT.resolver),
  };
}

// -- HTLC secrets ------------------------------------------------------------

/**
 * Deterministic per-swap HTLC preimage. Deriving rather than storing it means
 * a reinstalled wallet can still release or recognise its own locks.
 */
export function htlcPreimage(identitySk: Uint8Array, coordinationId: string): string {
  return bytesToHex(hmac(sha256, identitySk, utf8ToBytes(`pontmore/spark-htlc/preimage/v1:${coordinationId}`)));
}

export function paymentHashOf(preimageHex: string): string {
  return bytesToHex(sha256(hexToBytes(preimageHex)));
}

// -- PIP-02 commitments ------------------------------------------------------

export interface Commitment {
  algorithm: "sha256-bytes@1";
  digest: string;
}

/** PIP-02 `sha256-bytes@1` over the exact UTF-8 bytes of `text`. */
export function commit(text: string): Commitment {
  return { algorithm: "sha256-bytes@1", digest: `sha256:${bytesToHex(sha256(utf8ToBytes(text)))}` };
}

export function verifyCommitment(text: string, c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const { algorithm, digest } = c as Record<string, unknown>;
  return algorithm === "sha256-bytes@1" && digest === commit(text).digest;
}

export function sameCommitment(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return x.algorithm === y.algorithm && typeof x.digest === "string" && x.digest === y.digest;
}

export { bytesToHex, hexToBytes };
