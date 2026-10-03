/**
 * Shareable links. An agent link carries only the agent's npub; everything
 * else is discovered from relays.
 */
import * as nip19 from "nostr-tools/nip19";

export const SCHEME = "pontmore";

export function agentLink(pk: string): string {
  return `${SCHEME}://agent/${nip19.npubEncode(pk)}`;
}

/** Accepts pontmore://agent/<npub>, nostr:<npub>, a bare npub or hex pubkey. */
export function parseAgentLink(input: string): string | null {
  const v = input.trim();
  const m = /^(?:pontmore:\/\/agent\/|nostr:)?(npub1[02-9ac-hj-np-z]+|nprofile1[02-9ac-hj-np-z]+)$/i.exec(v);
  if (m) {
    try {
      const d = nip19.decode(m[1].toLowerCase());
      if (d.type === "npub") return d.data;
      if (d.type === "nprofile") return d.data.pubkey;
    } catch {
      return null;
    }
  }
  const hex = /^pontmore:\/\/agent\/([0-9a-f]{64})$/i.exec(v);
  return hex ? hex[1].toLowerCase() : null;
}

export function npub(pk: string): string {
  return nip19.npubEncode(pk);
}
