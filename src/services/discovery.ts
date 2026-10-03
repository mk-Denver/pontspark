/**
 * Agent discovery (PIP-00 + PIP-01 + NIP-69 offers).
 *
 * An agent is listed only when it has a valid Agent definition declaring
 * pontmore/swap@1, that definition references the same escrow descriptor as
 * its offer, and the descriptor is current and unexpired. A signature proves
 * authorship, not availability, so the UI still treats offers as claims.
 */
import type { Event } from "nostr-tools/pure";

import {
  AGENT_D_TAG,
  ESCROW_D_TAG,
  ESCROW_TYPE,
  KIND,
  OFFER_PLATFORM,
  SWAP_CAPABILITY,
  capabilityTag,
} from "../protocol/constants";
import { isOfferLive, parseOffer, type Offer } from "../protocol/offer";
import { latestByAddress, query } from "./nostr";

export interface AgentProfile {
  name?: string;
  about?: string;
  picture?: string;
  lud16?: string;
}

/** An agent's two offer directions in one currency, for display. */
export interface AgentMarket {
  currency: string;
  channels: string[];
  /** Customer buys bitcoin. */
  buy?: Offer;
  /** Customer sells bitcoin. */
  sell?: Offer;
}

export interface AgentListing {
  pk: string;
  profile: AgentProfile;
  definition: Event;
  descriptor: Event;
  /** One live NIP-69 offer per currency and direction. */
  offers: Offer[];
  markets: AgentMarket[];
}

function marketsOf(offers: Offer[]): AgentMarket[] {
  const by = new Map<string, AgentMarket>();
  for (const o of offers) {
    const m = by.get(o.currency) ?? { currency: o.currency, channels: [] };
    m[o.direction === "fiat_to_btc" ? "buy" : "sell"] = o;
    m.channels = [...new Set([...m.channels, ...o.channels])];
    by.set(o.currency, m);
  }
  return [...by.values()];
}

export function validDefinition(e: Event): string | null {
  try {
    if (e.kind !== KIND.agentDefinition) return null;
    if (!e.tags.some((t) => t[0] === "d" && t[1])) return null;
    if (!e.tags.some((t) => t[0] === "t" && t[1] === "agent")) return null;
    const c = JSON.parse(e.content) as { version?: unknown; capabilities?: unknown };
    if (!Array.isArray(c.capabilities) || !c.capabilities.length) return null;
    const declared = new Set(c.capabilities as string[]);
    const tagged = new Set(
      e.tags.filter((t) => t[0] === "t" && t[1]?.startsWith("pontmore-capability:")).map((t) => t[1].slice(20)),
    );
    // PIP-00: tags and content must agree exactly.
    if (declared.size !== tagged.size || [...declared].some((x) => !tagged.has(x))) return null;
    if (!declared.has(SWAP_CAPABILITY)) return null;
    return e.tags.find((t) => t[0] === "a" && t[3] === "escrow")?.[1] ?? null;
  } catch {
    return null;
  }
}

export function validDescriptor(e: Event, at = Math.floor(Date.now() / 1000)): boolean {
  try {
    if (e.kind !== KIND.escrowDescriptor) return false;
    if (e.tags.find((t) => t[0] === "d")?.[1] !== ESCROW_D_TAG) return false;
    const c = JSON.parse(e.content) as { version?: unknown; escrow_type?: unknown; networks?: unknown; expires_at?: unknown };
    if (c.version !== 1 || c.escrow_type !== ESCROW_TYPE) return false;
    if (!Array.isArray(c.networks) || !c.networks.length) return false;
    const tagged = e.tags.filter((t) => t[0] === "t" && t[1]?.startsWith("pontmore-network:")).map((t) => t[1].slice(17));
    if (tagged.some((n) => !(c.networks as string[]).includes(n))) return false;
    return typeof c.expires_at === "number" && c.expires_at > at;
  } catch {
    return false;
  }
}

function profileOf(e: Event | undefined): AgentProfile {
  if (!e) return {};
  try {
    const c = JSON.parse(e.content) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
    return { name: str(c.display_name) ?? str(c.name), about: str(c.about), picture: str(c.picture), lud16: str(c.lud16) };
  } catch {
    return {};
  }
}

/** `network` is the bitcoin network (NIP-69 `network`) this wallet runs on. */
async function assemble(offerEvents: Event[], network: string): Promise<AgentListing[]> {
  const offers: Offer[] = [];
  for (const e of latestByAddress(offerEvents)) {
    try {
      const o = parseOffer(e, { verify: false });
      if (isOfferLive(o) && o.network === network) offers.push(o);
    } catch {
      // Not ours to show.
    }
  }
  const authors = [...new Set(offers.map((o) => o.agent))];
  if (!authors.length) return [];
  const escrowPks = [...new Set(offers.map((o) => o.escrow.split(":")[1]))];

  const [defs, descs, profiles] = await Promise.all([
    query({ kinds: [KIND.agentDefinition], authors, "#d": [AGENT_D_TAG] }),
    query({ kinds: [KIND.escrowDescriptor], authors: escrowPks, "#d": [ESCROW_D_TAG] }),
    query({ kinds: [KIND.profile], authors }),
  ]);
  const defBy = new Map(latestByAddress(defs).map((d) => [d.pubkey, d]));
  const descBy = new Map(latestByAddress(descs).map((d) => [`${KIND.escrowDescriptor}:${d.pubkey}:${ESCROW_D_TAG}`, d]));
  const profBy = new Map(latestByAddress(profiles).map((p) => [p.pubkey, p]));

  const listings: AgentListing[] = [];
  for (const pk of authors) {
    const definition = defBy.get(pk);
    if (!definition) continue;
    const escrow = validDefinition(definition);
    if (!escrow) continue;
    const descriptor = descBy.get(escrow);
    if (!descriptor || !validDescriptor(descriptor)) continue;
    const mine = offers.filter((o) => o.agent === pk && o.escrow === escrow);
    if (!mine.length) continue;
    listings.push({ pk, profile: profileOf(profBy.get(pk)), definition, descriptor, offers: mine, markets: marketsOf(mine) });
  }
  return listings;
}

export async function discoverAgents(network: string, currency?: string): Promise<AgentListing[]> {
  const events = await query({
    kinds: [KIND.offer],
    "#y": [OFFER_PLATFORM],
    "#s": ["pending"],
    ...(currency ? { "#f": [currency] } : {}),
    limit: 500,
  });
  return assemble(events, network);
}

export async function fetchAgent(network: string, pk: string): Promise<AgentListing | null> {
  const events = await query({ kinds: [KIND.offer], authors: [pk], "#y": [OFFER_PLATFORM] });
  return (await assemble(events, network))[0] ?? null;
}

export async function fetchProfile(pk: string): Promise<AgentProfile> {
  const events = await query({ kinds: [KIND.profile], authors: [pk] });
  return profileOf(latestByAddress(events)[0]);
}

/** Completed swaps attested by an agent's escrow key: a rough, public track record. */
export async function completedSwaps(escrowPk: string): Promise<number> {
  const events = await query({ kinds: [KIND.action], authors: [escrowPk], limit: 500 }, 4000);
  return events.filter((e) => {
    try {
      return (JSON.parse(e.content) as { action?: string }).action === "core/settle";
    } catch {
      return false;
    }
  }).length;
}

export { capabilityTag };
