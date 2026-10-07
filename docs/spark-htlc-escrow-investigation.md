# Is a Spark HTLC equivalent to a Lightning hold invoice as an escrow mechanism for `pontmore/swap@1`?

- Status: Investigation (written comparison + recommendation, not a spec change)
- Scope: PIP-01 escrow-type registry, `pontmore/swap@1` participant-held escrow
- Date: 2026-10-07
- Related: pontmore/protocol#26 (conformance vectors), pontspark commit 722aa16

## Headline finding (the premise needs correcting)

The issue assumes Pontspark "already uses an unregistered `spark_htlc` type." That is no longer true in code. As of commit **722aa16** (2026-10-04, "fix: escrow swaps in a Lightning hold invoice", shipped in v0.2.0), Pontspark abandoned direct Spark-to-Spark HTLCs and switched to a **Lightning hold invoice between two Breez Spark wallets**. The constants, descriptor template, and wallet code now use:

- `ESCROW_TYPE = "spark_hold_invoice"`, `ESCROW_NETWORK = "spark"`, descriptor `networks: ["spark"]` (`src/protocol/constants.ts:45-47`, `src/protocol/events.ts:40-55`)
- recipient creates a Bolt11 HODL invoice (`wallet.holdInvoice` -> `ReceivePaymentMethod.Bolt11Invoice { paymentHash }`); provider pays it (`wallet.payHoldInvoice` -> `sendPayment` Bolt11, checking amount + hash); recipient claims with the preimage (`wallet.claimHtlc`); unclaimed fails back (`src/services/wallet.ts:436-477`)
- preimage still deterministic: `HMAC-SHA256(identitySk, "pontmore/spark-htlc/preimage/v1:" + coordinationId)` (`src/lib/keys.ts:75-76`)

The commit message states the reason plainly: *"Spark operators refuse direct wallet-to-wallet HTLCs ('HTLC creation failed ... leaf spending errors'), so no swap could ever lock."* Pontspark's **README is stale** on this point: line 94, line 132, and the "Escrow" badge still describe `spark_htlc` and "sats locked to the customer's Spark address," but the code no longer does that.

So there are now three mechanisms to compare, not two: the original `spark_htlc` (direct, abandoned), `lightning_hold_invoice` (the PIP-01 reference), and `spark_hold_invoice` (Pontspark's current reality, which is mechanically a Lightning hold invoice).

## Comparison table

| Axis | `lightning_hold_invoice` (PIP-01) | `spark_htlc` - direct Spark-to-Spark HTLC (original, abandoned) | `spark_hold_invoice` - HODL invoice between two Spark wallets (current) |
|---|---|---|---|
| Custody & enforcement | Lightning HTLC chain with on-chain CLTV fallback. **No trusted operators** ("the only exception is Lightning" - Spark trust-model doc). Held by the issuer's Lightning node. | Spark operators (the SE) under the **1-of-n moment-in-time** model. Hash-lock + expiry enforced off-chain by the SE cooperating; L1 sovereignty (pre-signed exit txs, decrementing timelocks) covers regular leaf ownership, **not documented for HTLC-encumbered leaves**. **Operators refuse to create these at all** (commit 722aa16). | Same enforcement as `lightning_hold_invoice` - it *is* a Bolt11 HODL invoice paid over Lightning. No new trust beyond the Lightning route + Breez LSP liveness. |
| Who holds funds while locked | Held by issuer (recipient); payer's funds in flight along the route. | Locked to the recipient's Spark address - **participant-held**, not service-held. | Held by the recipient's Lightning/Spark node as a pending incoming payment. **Participant-held.** |
| Role of `core/escrow` | Attester of `secure/settle/refund`; does not move funds (when used participant-to-participant). | Attester; does not move funds. In Pontspark it's the agent's own NIP-06 account-1 key - a **distinct pubkey** (swap@1 enforces all four roles distinct, `swap.ts:181`) but **controlled by the agent**, i.e. self-attestation by the counterparty. | Same as `lightning_hold_invoice`. `core/escrow` is an attester, not a custodian. |
| `core/secure` | Attests the held payment exists and matches terms (amount, hash, expiry). | Escrow key signs after verifying the lock in its own wallet. | Escrow key signs after `verifyIncomingLock` confirms the held Bolt11 payment is in the wallet with correct amount/hash/expiry (`swapEngine.ts:264-278`). |
| `core/authorize_settlement` | Fiat receiver signs after `swap/fiat_confirmed`. Meaningful. | Same. | Same. |
| `core/settle` | Attests the claim happened; the actual fund movement is the Lightning `claimHtlcPayment`, **not** the kernel action. Laggard. | Attests the claim; actual movement is the Spark claim. | Attests the claim; actual movement is `claimHtlcPayment`. |
| `core/authorize_refund` | Bitcoin provider signs after `fiat_pay_by` with no `swap/fiat_sent`. | Same. | Same. |
| `core/refund` | Attests the expiry/return; actual movement is the Lightning payment failing back. | Attests expiry; actual movement is the lock returning to sender. | Attests the return; actual movement is the held Bolt11 payment failing back (`status === "returned"`). |
| Any kernel action meaningless/unenforceable? | No, but `settle`/`refund` are attestations-after-the-fact; a dishonest escrow key can **grief** by refusing to sign after funds already moved (chain stuck in `settlement_authorized` while recipient has sats). Cannot forge outcomes (`settle` needs the fiat receiver's `authorize_settlement`; `refund` needs the provider's `authorize_refund`). | Same grief risk; plus the lock itself can't be created. | Same as `lightning_hold_invoice`. |
| Timeouts / practical bounds | Bounded by CLTV deltas and routing-node tolerance for long-held HTLCs. | `expiryDurationSecs` via SDK; Pontspark used `fiat_confirm_by + 2h` grace. **Moot** - refused. | **~4h hold cap** on Breez/Spark incoming HODL payments (constants comment + commit msg). Pontspark fits `confirmWindow=3h` + `htlcGrace=1h` ~ 4h. **Tighter than pure Lightning**; long fiat rails may not fit. |
| Verifiability by counterparty | Payer decodes Bolt11 -> amount, hash, expiry. Recipient sees hold in wallet. | Recipient verifies in own wallet (`findHtlc`). Counterparty sees only the gift-wrapped `locked` payload. | Provider decodes the Bolt11 invoice (amount, hash, expiry) before paying (`wallet.ts:472-474`); recipient verifies the held payment in wallet. |
| Verifiability by a third party / resolver | Given the Bolt11 string, can verify terms; **cannot** see live hold status without wallet/L1 access. | **Cannot** verify Spark state - only the recipient's wallet. Public chain carries only a private `locked` payload. | Same as `lightning_hold_invoice`: third party can verify the Bolt11 terms if given the string, but not live hold status. |
| Dispute effects actually honourable | `resume`, `cancel` honoured. `authorize_settlement` only **permits** settle - **only the preimage holder can actually settle**. `authorize_refund` only permits refund - **only expiry actually refunds**. Resolver is advisory. | Same limitations; plus resolver can't force anything the operators refuse. | Same as `lightning_hold_invoice`: resolver limited to advisory/chain-state effects; only P-holder settles, only expiry refunds. |
| Preimage custody | App-managed (Breez SDK: "Preimages are required to be unique and are not managed by the SDK"). | Pontspark derives `P = HMAC(identitySk, root id)` - recoverable on reinstall. | Same deterministic derivation (`keys.ts:75-76`); label still says `spark-htlc/preimage/v1`. |
| Failure modes | Routing failure, channel force-close on long holds, fee/liquidity limits. | Operator downtime halts off-chain transfers (Spark limitations doc: "unable to continue to send off-chain payments"; only L1 exit remains); **direct HTLC creation refused**. | Breez/Spark LSP outage halts create/pay/claim; Lightning routing failure; ~4h cap races claim; idempotency key from `pontmore/lock/${id}` prevents double-lock. |
| Idempotency | App's responsibility. | `idempotencyUuid(sha256(seed))` per lock. | Same UUID-based idempotency on `payHoldInvoice`. |
| Privacy | Bolt11 reveals amount, hash, expiry, description to anyone who sees it; routing nodes see amount/timing. | Spark transfers are off-chain, more private (only SE sees them). | Same as `lightning_hold_invoice` (Bolt11 over Lightning); Breez/Spark also sees it. |
| Amount limits | Lightning channel liquidity along the route. | Spark leaf sizes; unilateral exit only > 16,348 sats (beta, single-session). | Lightning liquidity; plus Spark's L1-exit caveat (not relevant to held Lightning payments). |

Sources: PIP-01-escrow-descriptor.md, PIP-02-coordination-event-chains.md, profiles/swap-v1.md (pontmore/protocol); crates/core/src/lib.rs (pontmore/pontmore, `validate_descriptor_fields`); Breez SDK HTLC guide (sdk-doc-spark.breez.technology/guide/htlcs.html); Spark trust-model, sovereignty, unilateral-exit, limitations, transfers pages (docs.spark.money); pontspark `src/protocol/*`, `src/services/wallet.ts`, `src/services/swapEngine.ts`, commit 722aa16.

## Per-question notes (where the two diverge or depend on a service)

### Custody / enforcement

This is the real, non-cosmetic difference for `spark_htlc`: it is operator-enforced under 1-of-n, whereas `lightning_hold_invoice` is trustless on-chain-enforced. Spark's own docs call Lightning "the only exception" to operator trust. The unilateral-exit docs cover leaf *ownership*, not an HTLC leaf's hash-lock/expiry; and in any case operators refuse to mint the HTLC. `spark_hold_invoice` reuses Lightning enforcement, so this difference disappears for the current mechanism.

### Participant-held vs service-held

Both Spark mechanisms lock funds to/with the counterparty, not a third-party escrow service - so `core/escrow` is an attester, not a custodian. PIP-02/swap@1 already require `core/escrow` to be a *distinct pubkey* from agent and customer; what they do **not** require is that it be a *different person*. Pontspark uses the agent's own NIP-06 account-1 key, so the "escrow authority" is the agent self-attesting with a separate key. That is the meaningful trust fact, and it belongs in the profile, not the escrow type.

### Settlement / refund mapping

For all three, the kernel escrow actions are attestations; the wallet's `claimHtlcPayment` / fail-back is what actually moves sats. No kernel action is meaningless, but `core/settle` and `core/refund` are laggards - the chain can desync from reality if the escrow key refuses to sign after funds already moved. The kernel's gating (settle needs the fiat receiver's authorize_settlement; refund needs the provider's authorize_refund) prevents a lone escrow key from forging an outcome, but not from griefing.

### Timeouts

The binding constraint for the *current* mechanism is Spark/Breez's ~4h hold cap, which is tighter and less flexible than a pure-Lightning hold invoice. `fiat_pay_by`/`fiat_confirm_by` plus release margin fit only if the confirm window stays <= ~3h. This is a profile-level timing constraint, not a mechanism-compatibility fact.

### Verifiability

No hash-lock escrow lets a resolver see live hold status without wallet/L1 access; the best a third party can do is verify the invoice/lock *terms* from the privately-exchanged payload. This is identical for `lightning_hold_invoice` and `spark_hold_invoice`; `spark_htlc` is strictly worse (Spark state is not externally observable).

### Dispute resolution

Only the preimage holder (the bitcoin provider = fiat receiver in Pontspark's design) can settle; only expiry can refund. A resolver's `authorize_settlement`/`authorize_refund`/`cancel` are advisory - consistent with PIP-02's "a resolution never moves funds." This is the same for all three and is inherent to participant-held hash-lock escrow. Pontspark's resolver is the agent's own derived key (no neutral arbitrator) - a profile trust fact.

### Preimage custody

Pontspark's deterministic `HMAC(identitySk, root id)` is sound for recovery (a reinstall re-derives P) and idempotency, but it couples preimage secrecy to the identity key: compromising the identity key lets an attacker derive any swap's P and force/grief settlement. The profile should *recommend* deterministic derivation or app-managed storage, with this trade-off noted, rather than *require* one scheme.

## Recommendation

**Do not register `spark_htlc`.** It is not equivalent to a Lightning hold invoice (operator-enforced under 1-of-n vs. trustless on-chain-enforced; participant-held with unclear L1 HTLC enforcement), and it is **empirically non-functional** - Spark operators refuse direct wallet-to-wallet HTLCs, which is exactly why Pontspark removed it. Registering it would advertise a mechanism that cannot settle a swap today. This is outcome (c) from the issue: keep it out of the initial list and document it as an implementation-specific type that was tried and abandoned (pontspark commit 722aa16; the stale README at lines 94/132 and the badge should be corrected to match).

**For Pontspark's current mechanism, prefer the existing `lightning_hold_invoice` type over a new `spark_hold_invoice` type.** `spark_hold_invoice` is mechanically a Bolt11 HODL invoice paid over Lightning - the same mechanism PIP-01 already registers. PIP-01 is explicit that "identifiers communicate mechanism compatibility only. Subtype operations, timeouts, dispute behavior, and settlement mechanics belong to the service schema or coordination profile." The facts that distinguish Pontspark's usage - *both sides need HODL-capable wallets, the recipient must accept a caller-supplied payment hash, and the practical hold is ~4h on Breez/Spark* - are wallet-capability and timing facts. They belong in the `pontmore/swap@1` participant-held-escrow text (or a service schema), not a new escrow type. Creating `spark_hold_invoice` would fragment the namespace for a non-mechanism difference and contradict PIP-01's own boundary.

The concrete conformance change Pontspark would need to drop under `lightning_hold_invoice`: add `lightning` to `content.networks` (and the `pontmore-network:lightning` tag) and set the root's `terms.bitcoin.network` to `lightning` (today both are `spark`, `src/protocol/offer.ts:171`, `events.ts:46-51`). Treating `spark` as a network that implies `lightning` is a PIP-01 interpretation call worth making explicit, but the cleanest path is to declare `lightning`.

**If** the community still wants a distinct identifier to signal "Spark-wallet-paired HODL invoice" as a hard interop constraint (so a generic Lightning client knows it cannot *issue* the hold side), the acceptable fallback is to register `spark_hold_invoice` with explicit constraints - but this investigation recommends against it for the reason above.

## Proposed `pontmore/swap@1` text (participant-held escrow) - needed regardless of type

Add a section to `profiles/swap-v1.md`, e.g. after "Kernel Authorization":

> ### Participant-held hash-lock escrow
>
> When the accepted escrow descriptor declares a hash-lock mechanism used directly between the two participants (e.g. `lightning_hold_invoice` issued by the bitcoin recipient), the bound `core/escrow` is an **attester**, not a custodian: it does not hold funds. `core/secure` attests that a lock matching `terms.bitcoin` (amount, payment hash, and an expiry no earlier than `terms.deadlines.fiat_confirm_by`) is observable in the recipient's wallet; `core/settle` attests that the recipient has claimed; `core/refund` attests that the lock has expired and returned. The actual fund movement is performed by the escrow mechanism (Lightning claim or fail-back), not by the kernel action.
>
> A profile-conforming `core/escrow` MUST be a distinct pubkey from `swap/agent` and `swap/customer`, but it MAY be controlled by the same party as one of them; the descriptor and profile MUST NOT imply that `core/escrow` is a neutral custodian when it is not.
>
> Only the preimage holder can settle a hash-lock escrow, and only expiry can refund it. Therefore a `core/resolve_dispute` effect of `authorize_settlement` only permits the bound escrow to record `core/settle`; it does not release a preimage. `authorize_refund` only permits `core/refund`; it does not accelerate expiry. A resolver's effects are advisory to the chain and cannot move funds, consistent with PIP-02.
>
> When the mechanism imposes a maximum hold time (e.g. Lightning hold invoices held by a Spark/Breez wallet are held for about four hours), the profile's `deadlines.fiat_confirm_by` plus a release margin MUST fit inside that hold. Profiles/clients SHOULD derive the preimage deterministically from the participant's identity key and the coordination id (so a reinstall can still release or recognize its own locks), or manage preimages with equivalent recoverability.

## Proposed PIP-01 change (only if `spark_hold_invoice` is registered as the fallback option)

If the fallback is taken, add to the "Escrow Types" list:

> - `spark_hold_invoice`
>   - a Lightning hold invoice (Bolt11 HODL) issued by the bitcoin recipient against a payment hash announced by the bitcoin provider, settled over Lightning between two wallets that can issue and hold a HODL invoice with a caller-supplied payment hash
>   - `networks` MUST include `lightning`; `spark` MAY also be present to signal a Spark-wallet pairing
>   - participant-held: `core/escrow` attests; it does not custody. Practical hold time is bounded by the receiving wallet's HODL hold (about four hours on Breez/Spark); the coordination profile's confirm deadline plus release margin MUST fit inside it.

And mirror the required-network rule in the Rust `validate_descriptor_fields` match arm:

```rust
"spark_hold_invoice" => Some("lightning"),
```

(pontmore/pontmore `crates/core/src/lib.rs`).

## Conformance vectors

As the issue notes, vectors would follow under "Host conformance vectors" in protocol issue #26. The participant-held-escrow text above adds cases worth covering:

- `core/settle` after a real claim but with the escrow key refusing to sign (grief)
- `core/refund` racing the hold's ~4h expiry
- resolver `authorize_settlement` that the preimage holder then withholds (no fund movement)
- a reinstall re-deriving P to claim a previously-locked swap

## Side recommendations for Pontspark (not protocol changes)

- Update the stale README: line 94, line 132, and the "Escrow" badge still say `spark_htlc` / "Spark HTLC"; the code uses `spark_hold_invoice` (a Lightning hold invoice). `src/protocol/constants.ts:39-43` already documents the switch.
- The preimage derivation label `pontmore/spark-htlc/preimage/v1` (`keys.ts:76`) is now a misnomer; leave it for backward-compat with in-flight swaps, but note it.

## Bottom line

`spark_htlc` (direct Spark-to-Spark HTLC) is **not equivalent** to a Lightning hold invoice and is non-functional in production - keep it out of PIP-01 and document it as abandoned. Pontspark's current `spark_hold_invoice` **is** mechanically a `lightning_hold_invoice`; express it under the existing type (add `lightning` to networks) and capture the participant-held / ~4h-hold / self-attesting-`core/escrow` facts in `pontmore/swap@1`, not in a new escrow type.

## References

- PIP-01 escrow types: https://github.com/pontmore/protocol/blob/main/PIP-01-escrow-descriptor.md
- PIP-02 coordination event chains: https://github.com/pontmore/protocol/blob/main/PIP-02-coordination-event-chains.md
- `pontmore/swap@1` profile: https://github.com/pontmore/protocol/blob/main/profiles/swap-v1.md
- Rust reference implementation (PIP-01 validation): https://github.com/pontmore/pontmore/blob/main/crates/core/src/lib.rs
- Breez SDK, Spark HTLC payments: https://sdk-doc-spark.breez.technology/guide/htlcs.html
- Spark trust model: https://docs.spark.money/learn/trust-model
- Spark sovereignty: https://docs.spark.money/learn/sovereignty
- Spark unilateral exit: https://docs.spark.money/wallets/unilateral-exit
- Spark limitations / attacks: https://docs.spark.money/learn/limitations
- Spark transfers: https://docs.spark.money/learn/transfers
- Spark HTLC API: https://docs.spark.money/api-reference/wallet/create-htlc
- Pontspark escrow transition commit: https://github.com/pontmore/pontspark/commit/722aa16721d30aaf6bffc396181dd93a5ce0b393
- Pontspark escrow flow (README, partly stale): https://github.com/pontmore/pontspark#how-a-swap-works
- Conformance vectors tracking: https://github.com/pontmore/protocol/issues/26
