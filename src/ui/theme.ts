import { useColorScheme } from "react-native";

/** Brand: Pontspark (Pontmore family) green and orange on warm cream / deep forest. */
const light = {
  bg: "#f7f3ea",
  surface: "#ffffff",
  surfaceAlt: "#efe9dc",
  border: "#e3dccd",
  text: "#101a13",
  textMuted: "#5b665e",
  textFaint: "#8f978f",
  primary: "#2f9e44",
  primaryText: "#ffffff",
  primarySoft: "#e3f3e6",
  accent: "#f08c00",
  accentSoft: "#fdefd9",
  danger: "#d64545",
  dangerSoft: "#fbe4e4",
  warning: "#b96b00",
  warningSoft: "#fdf1dd",
  info: "#2b6cb0",
  infoSoft: "#e3eefa",
  overlay: "rgba(16,26,19,0.45)",
  hero: "#101a13",
  heroText: "#f7f3ea",
  heroMuted: "#b5c2b8",
};

const dark: typeof light = {
  bg: "#0c140f",
  surface: "#16221a",
  surfaceAlt: "#1d2b22",
  border: "#273629",
  text: "#f7f3ea",
  textMuted: "#b5c2b8",
  textFaint: "#7d8a80",
  primary: "#57c26a",
  primaryText: "#07110a",
  primarySoft: "#1c3322",
  accent: "#ffb24d",
  accentSoft: "#3a2a12",
  danger: "#f27474",
  dangerSoft: "#3b1d1d",
  warning: "#ffb24d",
  warningSoft: "#3a2a12",
  info: "#9bd2ff",
  infoSoft: "#17283a",
  overlay: "rgba(0,0,0,0.6)",
  hero: "#17251b",
  heroText: "#f7f3ea",
  heroMuted: "#91a597",
};

export type Colors = typeof light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

export const type = {
  hero: { fontSize: 44, fontWeight: "700" as const, letterSpacing: -1 },
  display: { fontSize: 32, fontWeight: "700" as const, letterSpacing: -0.6 },
  title: { fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: "600" as const },
  body: { fontSize: 16, fontWeight: "400" as const, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: "600" as const },
  caption: { fontSize: 13, fontWeight: "400" as const, lineHeight: 18 },
  tiny: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.6 },
};

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}

export { light as lightColors, dark as darkColors };
