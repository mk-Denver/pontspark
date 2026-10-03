/**
 * Relay access. One pool for the app; every event that reaches application
 * logic has had its signature verified by the pool.
 */
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, type Event, type EventTemplate } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";

let pool: SimplePool | null = null;
let relays: string[] = [];

export function setRelays(urls: string[]) {
  relays = [...new Set(urls)];
}

export function getRelays(): string[] {
  return relays;
}

function p(): SimplePool {
  if (!pool) {
    pool = new SimplePool({ enablePing: true, enableReconnect: true });
  }
  return pool;
}

export function sign(template: EventTemplate, sk: Uint8Array): Event {
  return finalizeEvent(template, sk);
}

/** Publish to all relays; resolves when at least one accepts. */
export async function publish(event: Event): Promise<Event> {
  if (!relays.length) throw new Error("No relays configured");
  const results = await Promise.allSettled(p().publish(relays, event, { maxWait: 8000 }));
  if (!results.some((r) => r.status === "fulfilled")) {
    const reason = results.map((r) => (r.status === "rejected" ? String(r.reason) : "")).find(Boolean);
    throw new Error(`No relay accepted the event${reason ? `: ${reason}` : ""}`);
  }
  return event;
}

export async function publishAll(events: Event[]): Promise<void> {
  await Promise.all(events.map(publish));
}

export async function query(filter: Filter, maxWait = 5000): Promise<Event[]> {
  if (!relays.length) return [];
  return p().querySync(relays, filter, { maxWait });
}

/** Latest replaceable/addressable event per (pubkey, d) from a result set. */
export function latestByAddress(events: Event[]): Event[] {
  const best = new Map<string, Event>();
  for (const e of events) {
    const d = e.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const key = `${e.kind}:${e.pubkey}:${d}`;
    const cur = best.get(key);
    // NIP-01: newest wins; ties break on lowest id.
    if (!cur || e.created_at > cur.created_at || (e.created_at === cur.created_at && e.id < cur.id)) best.set(key, e);
  }
  return [...best.values()];
}

export function subscribe(filters: Filter[], onEvent: (e: Event) => void, onEose?: () => void): () => void {
  if (!relays.length) return () => undefined;
  const subs = filters.map((f, i) =>
    p().subscribeMany(relays, f, {
      onevent: onEvent,
      oneose: i === 0 ? onEose : undefined,
    }),
  );
  return () => subs.forEach((s) => s.close());
}

export function relayStatus(): Map<string, boolean> {
  return pool ? pool.listConnectionStatus() : new Map();
}

export function resetPool() {
  pool?.destroy();
  pool = null;
}
