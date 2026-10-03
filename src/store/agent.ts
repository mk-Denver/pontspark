/**
 * Agent mode configuration: markets the agent serves, pricing, limits and the
 * payment details customers pay into. Payment details stay on the device and
 * are sent only to a counterparty, inside a gift wrap, after acceptance.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Event } from "nostr-tools/pure";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ChannelDetails } from "../lib/channels";

export interface MarketSide {
  enabled: boolean;
  /** Buy: premium customers pay over market. Sell: discount under market. */
  spreadPct: number;
  min: string;
  max: string;
}

export interface Market {
  currency: string;
  /** Channel id -> the agent's own payment details on that channel. */
  channels: Record<string, ChannelDetails>;
  buy: MarketSide;
  sell: MarketSide;
}

interface AgentState {
  configured: boolean;
  markets: Market[];
  autoAccept: boolean;
  online: boolean;
  descriptor: Event | null;
  lastPublishedAt: number | null;
  publishError: string | null;

  saveMarkets(markets: Market[]): void;
  setAutoAccept(v: boolean): void;
  setOnline(v: boolean): void;
  setDescriptor(e: Event): void;
  setPublished(at: number | null, error?: string | null): void;
  reset(): void;
}

export const defaultMarket = (currency: string): Market => ({
  currency,
  channels: {},
  buy: { enabled: true, spreadPct: 2, min: currency === "USD" || currency === "EUR" || currency === "GBP" ? "5" : "100", max: currency === "USD" || currency === "EUR" || currency === "GBP" ? "500" : "50000" },
  sell: { enabled: true, spreadPct: 2, min: currency === "USD" || currency === "EUR" || currency === "GBP" ? "5" : "100", max: currency === "USD" || currency === "EUR" || currency === "GBP" ? "500" : "50000" },
});

export const useAgent = create<AgentState>()(
  persist(
    (set) => ({
      configured: false,
      markets: [],
      autoAccept: true,
      online: false,
      descriptor: null,
      lastPublishedAt: null,
      publishError: null,

      saveMarkets: (markets) => set({ markets, configured: markets.length > 0 }),
      setAutoAccept: (autoAccept) => set({ autoAccept }),
      setOnline: (online) => set({ online }),
      setDescriptor: (descriptor) => set({ descriptor }),
      setPublished: (lastPublishedAt, publishError = null) => set({ lastPublishedAt, publishError }),
      reset: () =>
        set({ configured: false, markets: [], online: false, descriptor: null, lastPublishedAt: null, publishError: null }),
    }),
    {
      name: "pontmore.agent",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        configured: s.configured,
        markets: s.markets,
        autoAccept: s.autoAccept,
        online: s.online,
        descriptor: s.descriptor,
      }),
    },
  ),
);
