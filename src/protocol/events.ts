/**
 * Event templates. Signing happens at the call site with the right key from
 * the key ring: identity for participant actions, escrow for the descriptor
 * and escrow kernel actions, resolver for dispute resolutions.
 */
import type { EventTemplate } from "nostr-tools/pure";

import {
  AGENT_D_TAG,
  ESCROW_D_TAG,
  ESCROW_NETWORK,
  ESCROW_TYPE,
  KIND,
  OFFER_PLATFORM,
  PIP02_VERSION,
  SWAP_CAPABILITY,
  SWAP_PROFILE,
  capabilityTag,
  escrowAddress,
} from "./constants";
import type { CommitmentObject, SwapTerms } from "./swap";
import { offerDTag, orderType, type OfferContent } from "./offer";

const now = () => Math.floor(Date.now() / 1000);

export function agentDefinitionTemplate(escrowPk: string, relayHint = ""): EventTemplate {
  return {
    kind: KIND.agentDefinition,
    created_at: now(),
    tags: [
      ["d", AGENT_D_TAG],
      ["t", "agent"],
      ["t", capabilityTag(SWAP_CAPABILITY)],
      ["a", escrowAddress(escrowPk), relayHint, "escrow"],
    ],
    content: JSON.stringify({ version: 1, capabilities: [SWAP_CAPABILITY] }),
  };
}

export function escrowDescriptorTemplate(expiresAt: number): EventTemplate {
  return {
    kind: KIND.escrowDescriptor,
    created_at: now(),
    tags: [
      ["d", ESCROW_D_TAG],
      ["t", `pontmore-network:${ESCROW_NETWORK}`],
    ],
    content: JSON.stringify({
      version: 1,
      escrow_type: ESCROW_TYPE,
      networks: [ESCROW_NETWORK],
      expires_at: expiresAt,
    }),
  };
}

/** NIP-69 order event for one direction of an agent's offer. */
export function offerTemplate(offer: OfferContent): EventTemplate {
  const live = offer.status === "pending";
  return {
    kind: KIND.offer,
    created_at: now(),
    tags: [
      ["d", offerDTag(offer.currency, offer.direction)],
      ["k", orderType(offer.direction)],
      ["f", offer.currency],
      ["s", offer.status],
      ["amt", "0"],
      ["fa", offer.min, offer.max],
      ["pm", ...offer.channelLabels],
      ["premium", offer.premium],
      ...(offer.name ? [["name", offer.name]] : []),
      ...(offer.source ? [["source", offer.source]] : []),
      ["network", offer.network],
      ["layer", offer.layer],
      ["bond", "0"],
      ["expires_at", String(offer.expires_at)],
      // NIP-40: relays drop a live offer once it lapses. A withdrawal stays briefly so clients see it.
      ["expiration", String(live ? offer.expires_at : now() + 60 * 60)],
      ["y", OFFER_PLATFORM],
      ["z", "order"],
      // Pontmore terms; NIP-69 clients ignore these.
      ["protocol", SWAP_PROFILE],
      ["price", offer.price],
      ["channels", ...offer.channels],
      ["a", offer.escrow, "", "escrow"],
      ["p", offer.resolver, "", "core/resolver"],
    ],
    content: "",
  };
}

export function profileTemplate(meta: { name: string; about?: string; picture?: string; lud16?: string }): EventTemplate {
  const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v));
  return { kind: KIND.profile, created_at: now(), tags: [], content: JSON.stringify(clean) };
}

export function relayListTemplate(relays: string[]): EventTemplate {
  return { kind: KIND.relayList, created_at: now(), tags: relays.map((r) => ["r", r]), content: "" };
}

export interface RootInput {
  agent: string;
  customer: string;
  escrow: string;
  resolver: string;
  descriptorId: string;
  terms: SwapTerms;
  expiresAt: number;
  commitments?: Record<string, CommitmentObject>;
  createdAt?: number;
}

export function rootTemplate(input: RootInput): EventTemplate {
  return {
    kind: KIND.root,
    created_at: input.createdAt ?? now(),
    tags: [
      ["p", input.agent, "", "swap/agent"],
      ["p", input.customer, "", "swap/customer"],
      ["p", input.escrow, "", "core/escrow"],
      ["p", input.resolver, "", "core/resolver"],
      ["e", input.descriptorId, "", "escrow-version"],
      ["a", escrowAddress(input.escrow), "", "escrow"],
    ],
    content: JSON.stringify({
      version: PIP02_VERSION,
      profile: SWAP_PROFILE,
      terms: input.terms,
      expires_at: input.expiresAt,
      ...(input.commitments && Object.keys(input.commitments).length ? { commitments: input.commitments } : {}),
    }),
  };
}

export function actionTemplate(
  rootId: string,
  prevId: string,
  action: string,
  data?: Record<string, unknown>,
  routing: { pk: string; role: string }[] = [],
  createdAt?: number,
): EventTemplate {
  return {
    kind: KIND.action,
    created_at: createdAt ?? now(),
    tags: [
      ["e", rootId, "", "root"],
      ["e", prevId, "", "prev"],
      // Routing hints only; the root stays the canonical role binding.
      ...routing.map((r) => ["p", r.pk, "", r.role]),
    ],
    content: JSON.stringify({ version: PIP02_VERSION, action, ...(data ? { data } : {}) }),
  };
}

export { ESCROW_D_TAG };
