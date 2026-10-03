import { create } from "zustand";

import * as wallet from "../services/wallet";
import type { WalletTx } from "../services/wallet";

interface WalletState {
  status: "idle" | "connecting" | "ready" | "error";
  error?: string;
  balance: number | null;
  txs: WalletTx[];
  rates: Record<string, number>;
  lightningAddress: string | null;
  start(): Promise<void>;
  refresh(): Promise<void>;
  refreshRates(): Promise<void>;
  setLightningAddress(a: string): void;
  reset(): void;
}

let unsubscribe: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useWallet = create<WalletState>()((set, get) => ({
  status: "idle",
  balance: null,
  txs: [],
  rates: {},
  lightningAddress: null,

  async start() {
    if (get().status === "connecting" || get().status === "ready") return;
    set({ status: "connecting", error: undefined });
    try {
      await wallet.connect();
      unsubscribe?.();
      unsubscribe = wallet.onWalletEvent(() => {
        // Events arrive in bursts; coalesce into one refresh.
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void get().refresh(), 400);
      });
      set({ status: "ready" });
      await Promise.all([get().refresh(), get().refreshRates()]);
      wallet
        .lightningAddress()
        .then((a) => set({ lightningAddress: a }))
        .catch(() => undefined);
    } catch (e) {
      set({ status: "error", error: (e as Error).message });
    }
  },

  async refresh() {
    try {
      const [balance, txs] = await Promise.all([wallet.balanceSats(), wallet.listTransactions(60)]);
      set({ balance: Number(balance), txs });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  async refreshRates() {
    try {
      set({ rates: await wallet.fiatRates() });
    } catch {
      // Rates are a convenience; the wallet works without them.
    }
  },

  setLightningAddress: (a) => set({ lightningAddress: a }),

  reset() {
    unsubscribe?.();
    unsubscribe = null;
    set({ status: "idle", balance: null, txs: [], lightningAddress: null, error: undefined });
  },
}));
