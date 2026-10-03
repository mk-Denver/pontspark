import Constants from "expo-constants";

interface Extra {
  breezApiKey?: string;
  breezNetwork?: string;
  defaultRelays?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const BREEZ_API_KEY = extra.breezApiKey?.trim() || null;
export const BREEZ_NETWORK: "mainnet" | "regtest" = extra.breezNetwork === "regtest" ? "regtest" : "mainnet";

export const DEFAULT_RELAYS: string[] = (extra.defaultRelays || "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net")
  .split(",")
  .map((r) => r.trim())
  .filter((r) => r.startsWith("wss://"));
