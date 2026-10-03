const APP_ENV = process.env.EXPO_PUBLIC_APP_ENV || "development";
const IS_PRODUCTION = APP_ENV === "production";

const NATIVE = IS_PRODUCTION
  ? { name: "Pontspark", scheme: "pontmore", id: "xyz.pontmore.pontspark" }
  : { name: "Pontspark Dev", scheme: "pontmore", id: "xyz.pontmore.pontspark.dev" };

const CAMERA_COPY =
  "Pontspark uses the camera to scan payment and agent QR codes. No photos are stored.";

export default {
  expo: {
    name: NATIVE.name,
    slug: "pontspark",
    scheme: NATIVE.scheme,
    version: process.env.PONTSPARK_APP_VERSION || "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    backgroundColor: "#f7f3ea",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#f7f3ea",
      dark: { image: "./assets/splash.png", backgroundColor: "#0c140f" },
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: false,
      bundleIdentifier: NATIVE.id,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription: CAMERA_COPY,
        NSFaceIDUsageDescription: "Pontspark uses Face ID to protect your recovery phrase.",
      },
    },
    android: {
      package: NATIVE.id,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#f7f3ea",
      },
      permissions: ["CAMERA", "USE_BIOMETRIC"],
      intentFilters: [
        {
          action: "VIEW",
          category: ["BROWSABLE", "DEFAULT"],
          data: [{ scheme: NATIVE.scheme }],
        },
      ],
    },
    plugins: [
      "@breeztech/breez-sdk-spark-react-native",
      ["expo-camera", { cameraPermission: CAMERA_COPY }],
      "expo-secure-store",
      ["expo-local-authentication", { faceIDPermission: "Pontspark uses Face ID to protect your recovery phrase." }],
    ],
    extra: {
      appEnv: APP_ENV,
      breezApiKey: process.env.EXPO_PUBLIC_BREEZ_API_KEY,
      breezNetwork: process.env.EXPO_PUBLIC_BREEZ_NETWORK || "mainnet",
      defaultRelays: process.env.EXPO_PUBLIC_DEFAULT_RELAYS,
    },
  },
};
