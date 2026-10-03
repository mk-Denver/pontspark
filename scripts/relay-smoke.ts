/**
 * End-to-end protocol smoke test against live relays, without a wallet.
 *
 * Two throwaway identities run a full fiat_to_btc swap: agent publishes its
 * descriptor, definition and offer; the customer discovers it, proposes a
 * root and sends the gift-wrapped request; both sides walk the chain to
 * `settled`. Uses the ISO 4217 test currency XTS so nobody sees a real offer.
 *
 *   npx tsx scripts/relay-smoke.ts [wss://relay ...]
 */
import { KIND, SWAP_TIMING, escrowAddress } from "../src/protocol/constants";
import { actionTemplate, agentDefinitionTemplate, escrowDescriptorTemplate, offerTemplate, rootTemplate } from "../src/protocol/events";
import { checkRootAgainstOffer, quote } from "../src/protocol/offer";
import { openWrap, wrapPayload } from "../src/protocol/payloads";
import { parseRoot, reconstruct } from "../src/protocol/swap";
import { commit, deriveKeyRing, newMnemonic } from "../src/lib/keys";
import { discoverAgents } from "../src/services/discovery";
import { publish, query, resetPool, setRelays, sign } from "../src/services/nostr";

const relays = process.argv.slice(2).length ? process.argv.slice(2) : ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const now = () => Math.floor(Date.now() / 1000);
const step = (m: string) => console.log(`• ${m}`);

async function main() {
  setRelays(relays);
  const agent = deriveKeyRing(newMnemonic());
  const customer = deriveKeyRing(newMnemonic());

  step("agent publishes descriptor, definition and offer");
  const descriptor = await publish(sign(escrowDescriptorTemplate(now() + 3600), agent.escrow.sk));
  await publish(sign(agentDefinitionTemplate(agent.escrow.pk), agent.identity.sk));
  const offerEvent = await publish(
    sign(
      offerTemplate({
        direction: "fiat_to_btc",
        currency: "XTS",
        channels: ["mpesa_phone_ke_kes@2"],
        channelLabels: ["M-Pesa phone"],
        network: "regtest",
        layer: "spark",
        price: "10000000",
        min: "1",
        max: "1000",
        premium: "0",
        escrow: escrowAddress(agent.escrow.pk),
        resolver: agent.resolver.pk,
        expires_at: now() + 600,
        status: "pending",
        source: "pontmore smoke test",
      }),
      agent.identity.sk,
    ),
  );
  await new Promise((r) => setTimeout(r, 1500));

  step("customer discovers the agent");
  const listings = await discoverAgents("regtest", "XTS");
  const listing = listings.find((l) => l.pk === agent.identity.pk);
  if (!listing) throw new Error("agent not discovered");
  const offer = listing.offers[0];
  if (offer.event.id !== offerEvent.id) throw new Error("wrong offer");

  step("customer proposes a root and sends the private request");
  const q = quote(offer, "fiat_to_btc", "100")!;
  const privateTerms = JSON.stringify({ spark_address: "sp1testaddress" });
  const t = now();
  const root = await publish(
    sign(
      rootTemplate({
        agent: agent.identity.pk,
        customer: customer.identity.pk,
        escrow: agent.escrow.pk,
        resolver: agent.resolver.pk,
        descriptorId: listing.descriptor.id,
        terms: {
          direction: "fiat_to_btc",
          fiat: { currency: "XTS", amount: "100" },
          bitcoin: { amount: q.sats.toString(), unit: "sat", network: "spark" },
          payment_channel: "mpesa_phone_ke_kes@2",
          deadlines: { fiat_pay_by: t + SWAP_TIMING.payWindow, fiat_confirm_by: t + SWAP_TIMING.confirmWindow },
        },
        expiresAt: t + SWAP_TIMING.acceptWindow,
        commitments: { quote: commit(offer.raw), private_terms: commit(privateTerms) },
        createdAt: t,
      }),
      customer.identity.sk,
    ),
  );
  for (const w of wrapPayload(customer.identity.sk, customer.identity.pk, agent.identity.pk, root.id, [agent.identity.pk, customer.identity.pk], {
    type: "request",
    quote: offer.raw,
    private_terms: privateTerms,
  }))
    await publish(w);
  await new Promise((r) => setTimeout(r, 1500));

  step("agent finds the root and unwraps the request");
  const [seenRoot] = await query({ kinds: [KIND.root], "#p": [agent.identity.pk] });
  if (seenRoot?.id !== root.id) throw new Error("root not found by #p");
  const wraps = await query({ kinds: [KIND.giftWrap], "#p": [agent.identity.pk], since: now() - 3 * 86400 });
  const request = wraps.map((w) => openWrap(w, agent.identity.sk)).find((i) => i?.payload?.type === "request");
  if (!request || request.payload?.type !== "request") throw new Error("request not received");
  const parsed = parseRoot(seenRoot);
  const problems = checkRootAgainstOffer(parsed, request.payload.quote, agent.identity.pk, agent.escrow.pk);
  if (problems.length) throw new Error(problems.join("; "));
  if (parsed.descriptorId !== descriptor.id) throw new Error("descriptor mismatch");

  step("both sides walk the chain to settlement");
  const ref = commit(JSON.stringify({ coordination: root.id, reference: "QWE123" }));
  let prev = root.id;
  const act = async (sk: Uint8Array, action: string, data?: Record<string, unknown>) => {
    const ev = await publish(sign(actionTemplate(root.id, prev, action, data), sk));
    prev = ev.id;
  };
  await act(agent.identity.sk, "core/accept");
  await act(agent.escrow.sk, "core/secure");
  await act(customer.identity.sk, "swap/fiat_sent", { payment_reference: ref });
  await act(agent.identity.sk, "swap/fiat_confirmed", { payment_reference: ref });
  await act(agent.identity.sk, "core/authorize_settlement");
  await act(agent.escrow.sk, "core/settle");
  await new Promise((r) => setTimeout(r, 1500));

  const actions = await query({ kinds: [KIND.action], "#e": [root.id] });
  const state = reconstruct(parsed, actions);
  console.log(`  ${actions.length} actions from relays -> ${state.status}${state.forked ? " (forked)" : ""}`);
  if (state.status !== "settled") throw new Error(`expected settled, got ${state.status}`);

  step("agent retracts the offer");
  await publish(sign(offerTemplate({ ...offer, status: "canceled", expires_at: now() }), agent.identity.sk));
  await new Promise((r) => setTimeout(r, 1500));
  if ((await discoverAgents("regtest", "XTS")).some((l) => l.pk === agent.identity.pk)) throw new Error("withdrawn offer still listed");
  console.log("OK");
}

main()
  .then(() => {
    resetPool();
    process.exit(0);
  })
  .catch((e) => {
    console.error("FAILED:", e);
    resetPool();
    process.exit(1);
  });
