import { useNavigation } from "@react-navigation/native";
import * as LocalAuthentication from "expo-local-authentication";
import React, { useMemo, useState } from "react";
import { View } from "react-native";

import { storedMnemonic } from "../services/wallet";
import { useSession } from "../store/session";
import { Button, Card, Chip, Notice, Screen, Text, success } from "../ui/components";
import { toast, toastError } from "../ui/extras";
import { radius, space, useColors } from "../ui/theme";

async function authenticate(): Promise<boolean> {
  const has = await LocalAuthentication.hasHardwareAsync().catch(() => false);
  const enrolled = has && (await LocalAuthentication.isEnrolledAsync().catch(() => false));
  if (!enrolled) return true; // no lock set up; nothing to check against
  const res = await LocalAuthentication.authenticateAsync({ promptMessage: "Show recovery phrase" });
  return res.success;
}

function pickChecks(n: number): number[] {
  const idx = new Set<number>();
  while (idx.size < 3) idx.add(Math.floor(Math.random() * n));
  return [...idx].sort((a, b) => a - b);
}

export function BackupScreen() {
  const c = useColors();
  const nav = useNavigation();
  const backedUp = useSession((s) => s.backedUp);
  const markBackedUp = useSession((s) => s.markBackedUp);
  const [words, setWords] = useState<string[] | null>(null);
  const [stage, setStage] = useState<"intro" | "show" | "verify">("intro");
  const [checks, setChecks] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const options = useMemo(() => {
    if (!words) return {} as Record<number, string[]>;
    const out: Record<number, string[]> = {};
    for (const i of checks) {
      const pool = new Set([words[i]]);
      while (pool.size < 4) pool.add(words[Math.floor(Math.random() * words.length)]);
      out[i] = [...pool].sort(() => Math.random() - 0.5);
    }
    return out;
  }, [words, checks]);

  const reveal = async () => {
    try {
      if (!(await authenticate())) return;
      const m = await storedMnemonic();
      if (!m) throw new Error("No wallet found");
      const w = m.split(" ");
      setWords(w);
      setChecks(pickChecks(w.length));
      setStage("show");
    } catch (e) {
      toastError(e);
    }
  };

  if (stage === "intro") {
    return (
      <Screen back title="Back up" footer={<Button title="Show my recovery phrase" icon="eye" onPress={reveal} />}>
        <Text variant="title">Your recovery phrase is your wallet</Text>
        <Text muted>
          12 words that restore your bitcoin, your identity and your agent setup on any phone. Pontspark can't recover them for you.
        </Text>
        <Card tone="alt" style={{ gap: space.md }}>
          {[
            "Write the words on paper, in order.",
            "Keep the paper somewhere safe and private.",
            "Never share them. Anyone with these words can take your money.",
          ].map((t, i) => (
            <View key={i} style={{ flexDirection: "row", gap: space.md }}>
              <Text variant="label" color={c.primary}>
                {i + 1}
              </Text>
              <Text style={{ flex: 1 }}>{t}</Text>
            </View>
          ))}
        </Card>
        {backedUp && <Notice tone="success" title="Already backed up">You can view the words again any time.</Notice>}
      </Screen>
    );
  }

  if (stage === "show" && words) {
    return (
      <Screen
        back
        title="Recovery phrase"
        footer={<Button title={backedUp ? "Done" : "I've written them down"} onPress={() => (backedUp ? nav.goBack() : setStage("verify"))} />}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {words.map((w, i) => (
            <View key={i} style={{ width: "31.5%", flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: c.surface, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 10 }}>
              <Text variant="caption" faint style={{ width: 18 }}>
                {i + 1}
              </Text>
              <Text variant="label">{w}</Text>
            </View>
          ))}
        </View>
        <Notice tone="warning">Don't screenshot this. Screenshots often sync to the cloud.</Notice>
      </Screen>
    );
  }

  const allRight = checks.every((i) => answers[i] === words?.[i]);
  return (
    <Screen
      back
      title="Check"
      footer={
        <Button
          title="Confirm backup"
          disabled={!allRight}
          onPress={() => {
            markBackedUp();
            success();
            toast("Wallet backed up", "success");
            nav.goBack();
          }}
        />
      }
    >
      <Text variant="title">Let's make sure</Text>
      <Text muted>Pick the right word for each position.</Text>
      {checks.map((i) => (
        <View key={i} style={{ gap: space.sm }}>
          <Text variant="label">Word #{i + 1}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {(options[i] ?? []).map((w) => (
              <Chip key={w} label={w} selected={answers[i] === w} onPress={() => setAnswers({ ...answers, [i]: w })} />
            ))}
          </View>
        </View>
      ))}
      {checks.some((i) => answers[i] && answers[i] !== words?.[i]) && (
        <Notice tone="danger" action={<Button small kind="secondary" title="See words again" onPress={() => setStage("show")} />}>
          One of those isn't right.
        </Notice>
      )}
    </Screen>
  );
}
