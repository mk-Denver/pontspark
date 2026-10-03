import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isMnemonicWord, isValidMnemonic, mnemonicWordSuggestions } from "../lib/keys";
import { useSession } from "../store/session";
import { Button, Chip, Field, Logo, Notice, Screen, Text } from "../ui/components";
import { toastError } from "../ui/extras";
import { space, useColors } from "../ui/theme";

export function WelcomeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const createWallet = useSession((s) => s.createWallet);
  const [busy, setBusy] = useState(false);

  const points: { icon: React.ComponentProps<typeof Feather>["name"]; title: string; body: string }[] = [
    { icon: "shield", title: "Yours alone", body: "A self-custodial bitcoin wallet. Nobody else holds your keys." },
    { icon: "repeat", title: "Cash in, cash out", body: "Swap with local agents over M-Pesa, mobile money or bank." },
    { icon: "lock", title: "Protected swaps", body: "Bitcoin is locked before anyone sends money, and only released after." },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.hero, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.lg }}>
      <StatusBar style="light" />
      <View style={{ paddingHorizontal: space.xl, gap: space.xl, flex: 1 }}>
        <Logo size={64} />
        <View style={{ gap: space.sm }}>
          <Text variant="hero" color={c.heroText}>
            Bitcoin,{"\n"}your way.
          </Text>
          <Text variant="body" color={c.heroMuted}>
            Hold it, send it, and swap it with people near you.
          </Text>
        </View>
        <View style={{ gap: space.lg, marginTop: space.md }}>
          {points.map((p) => (
            <View key={p.title} style={{ flexDirection: "row", gap: space.md }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(247,243,234,0.1)", alignItems: "center", justifyContent: "center" }}>
                <Feather name={p.icon} size={18} color="#57c26a" />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label" color={c.heroText}>
                  {p.title}
                </Text>
                <Text variant="caption" color={c.heroMuted}>
                  {p.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <Button
          title="Create my wallet"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await createWallet();
            } catch (e) {
              toastError(e);
              setBusy(false);
            }
          }}
        />
        <Pressable onPress={() => nav.navigate("Restore")} style={{ alignItems: "center", padding: space.md }}>
          <Text variant="label" color={c.heroMuted}>
            I already have a wallet
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function RestoreScreen() {
  const restore = useSession((s) => s.restoreWallet);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const last = text.endsWith(" ") ? "" : (words[words.length - 1] ?? "");
  const suggestions = last && !isMnemonicWord(last) ? mnemonicWordSuggestions(last) : [];
  const bad = words.filter((w, i) => !isMnemonicWord(w) && (i < words.length - 1 || text.endsWith(" ")));
  const valid = (words.length === 12 || words.length === 24) && isValidMnemonic(text);

  return (
    <Screen
      back
      title="Restore"
      footer={
        <Button
          title="Restore wallet"
          disabled={!valid}
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await restore(text);
            } catch (e) {
              toastError(e);
              setBusy(false);
            }
          }}
        />
      }
    >
      <Text variant="title">Enter your recovery phrase</Text>
      <Text muted>Type your 12 or 24 words in order, separated by spaces. Your swaps, identity and agent setup come back with it.</Text>
      <Field
        value={text}
        onChangeText={setText}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        placeholder="word1 word2 word3 …"
        error={bad.length ? `Not in the word list: ${bad.join(", ")}` : null}
        hint={`${words.length} word${words.length === 1 ? "" : "s"}`}
      />
      {suggestions.length > 0 && (
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          {suggestions.map((s) => (
            <Chip key={s} label={s} onPress={() => setText([...words.slice(0, -1), s].join(" ") + " ")} />
          ))}
        </View>
      )}
      <Notice tone="warning" title="Only ever type this into Pontspark">
        Nobody from Pontspark, and no agent, will ever ask for these words.
      </Notice>
    </Screen>
  );
}
