/**
 * Agent mode publishing: PIP-00 Agent definition, PIP-01 escrow descriptor,
 * profile, relay list and the signed expiring offers.
 */
import type { Event } from "nostr-tools/pure";

import { ESCROW_D_TAG, ESCROW_NETWORK, KIND, SWAP_TIMING, escrowAddress } from "../protocol/constants";
import {
  agentDefinitionTemplate,
  escrowDescriptorTemplate,
  offerTemplate,
  profileTemplate,
  relayListTemplate,
} from "../protocol/events";
import type { OfferContent } from "../protocol/offer";
import type { Direction } from "../protocol/swap";
import { channelInfo, detailsComplete } from "../lib/channels";
import { agentLink } from "../lib/links";
import type { KeyRing } from "../lib/keys";
import { coarseFloor, compareDecimal, fromMinor, priceWithSpread, toMinor } from "../lib/money";
import type { Market, MarketSide } from "../store/agent";
import { useAgent } from "../store/agent";
import { validDescriptor } from "./discovery";
import { BREEZ_NETWORK } from "./config";
import { latestByAddress, publish, query, sign } from "./nostr";

const now = () => Math.floor(Date.now() / 1000);
const RENEW_MARGIN = 30 * 24 * 60 * 60;

/**
 * Keep one long-lived descriptor. Republishing it changes the exact revision
 * that in-flight roots pinned, so it is renewed only near expiry.
 */
export async function ensureDescriptor(keys: KeyRing): Promise<Event> {
  const { descriptor, setDescriptor } = useAgent.getState();
  if (descriptor && descriptor.pubkey === keys.escrow.pk && validDescriptor(descriptor, now() + RENEW_MARGIN)) {
    return descriptor;
  }
  const found = latestByAddress(
    await query({ kinds: [KIND.escrowDescriptor], authors: [keys.escrow.pk], "#d": [ESCROW_D_TAG] }),
  )[0];
  if (found && validDescriptor(found, now() + RENEW_MARGIN)) {
    setDescriptor(found);
    return found;
  }
  const fresh = await publish(sign(escrowDescriptorTemplate(now() + SWAP_TIMING.descriptorLifetime), keys.escrow.sk));
  setDescriptor(fresh);
  return fresh;
}

export async function publishIdentity(
  keys: KeyRing,
  profile: { name: string; about: string; lud16?: string | null },
  relays: string[],
): Promise<void> {
  await Promise.all([
    publish(sign(agentDefinitionTemplate(keys.escrow.pk), keys.identity.sk)),
    publish(sign(profileTemplate({ name: profile.name, about: profile.about, lud16: profile.lud16 ?? undefined }), keys.identity.sk)),
    publish(sign(relayListTemplate(relays), keys.identity.sk)),
  ]);
}

/** Customer-facing limits, with the max capped (coarsely) by what the agent can lock. */
function limits(cfg: MarketSide, price: string, capSats?: number): { min: string; max: string } | null {
  if (!cfg.enabled) return null;
  let max = cfg.max;
  if (capSats !== undefined) {
    const affordable = coarseFloor(fromMinor((BigInt(Math.max(0, Math.floor(capSats))) * toMinor(price)) / 100_000_000n));
    if (compareDecimal(affordable, max) < 0) max = affordable;
  }
  return compareDecimal(max, cfg.min) < 0 ? null : { min: cfg.min, max };
}

export interface MarketOffers {
  /** Customer buys bitcoin: the agent sells (`k=sell`). */
  buy?: OfferContent;
  /** Customer sells bitcoin: the agent buys (`k=buy`). */
  sell?: OfferContent;
}

/** The offers an agent would publish right now for one market. */
export function buildOffers(
  keys: KeyRing,
  market: Market,
  marketPrice: number,
  balanceSats: number,
  expiresAt: number,
  name?: string,
): MarketOffers {
  const channels = Object.keys(market.channels).filter((c) => detailsComplete(c, market.channels[c]));
  if (!channels.length || !marketPrice) return {};
  const make = (direction: Direction, cfg: MarketSide, sign: 1 | -1, capSats?: number): OfferContent | undefined => {
    const price = priceWithSpread(marketPrice, sign * cfg.spreadPct);
    const range = limits(cfg, price, capSats);
    if (!range) return undefined;
    return {
      direction,
      currency: market.currency,
      channels,
      channelLabels: channels.map((c) => channelInfo(c).label),
      network: BREEZ_NETWORK,
      layer: ESCROW_NETWORK,
      price,
      ...range,
      premium: String(sign * cfg.spreadPct),
      escrow: escrowAddress(keys.escrow.pk),
      resolver: keys.resolver.pk,
      expires_at: expiresAt,
      status: "pending",
      ...(name ? { name } : {}),
      source: agentLink(keys.identity.pk),
    };
  };
  // Keep a little headroom for Spark fees.
  return { buy: make("fiat_to_btc", market.buy, 1, balanceSats * 0.98), sell: make("btc_to_fiat", market.sell, -1) };
}

export async function publishOffers(
  keys: KeyRing,
  markets: Market[],
  rates: Record<string, number>,
  balanceSats: number,
  name?: string,
): Promise<number> {
  const expiresAt = now() + SWAP_TIMING.offerLifetime;
  let count = 0;
  for (const market of markets) {
    const built = buildOffers(keys, market, rates[market.currency], balanceSats, expiresAt, name);
    for (const direction of DIRECTIONS) {
      const offer = built[direction === "fiat_to_btc" ? "buy" : "sell"];
      // A side that can't be offered right now is withdrawn, so a stale one doesn't linger.
      await publish(sign(offerTemplate(offer ?? withdrawal(keys, market, direction)), keys.identity.sk));
      if (offer) count++;
    }
  }
  return count;
}

const DIRECTIONS: Direction[] = ["fiat_to_btc", "btc_to_fiat"];

/** A canceled order in an offer slot; NIP-69 clients drop it from listings. */
function withdrawal(keys: KeyRing, market: Market, direction: Direction): OfferContent {
  const cfg = direction === "fiat_to_btc" ? market.buy : market.sell;
  const channels = Object.keys(market.channels);
  return {
    direction,
    currency: market.currency,
    channels,
    channelLabels: channels.map((c) => channelInfo(c).label),
    network: BREEZ_NETWORK,
    layer: ESCROW_NETWORK,
    price: "1",
    min: cfg.min,
    max: cfg.max,
    premium: "0",
    escrow: escrowAddress(keys.escrow.pk),
    resolver: keys.resolver.pk,
    expires_at: now(),
    status: "canceled",
  };
}

/** Going offline withdraws every offer slot. */
export async function retractOffers(keys: KeyRing, markets: Market[]): Promise<void> {
  await Promise.allSettled(
    markets.flatMap((m) => DIRECTIONS.map((d) => publish(sign(offerTemplate(withdrawal(keys, m, d)), keys.identity.sk)))),
  );
}
