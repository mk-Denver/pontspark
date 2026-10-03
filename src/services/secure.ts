import * as SecureStore from "expo-secure-store";

// SecureStore keys allow only alphanumerics, ".", "-" and "_".
const PREFIX = "pontmore.";

export async function setSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(PREFIX + key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getSecret(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(PREFIX + key);
}

export async function deleteSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(PREFIX + key);
}
