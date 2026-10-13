import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Linking from "expo-linking";
import React, { useState } from "react";
import { Pressable, View } from "react-native";

import { useFiatOf } from "../hooks";
import { errorText } from "../lib/errors";
import { formatSats, formatFiat } from "../lib/money";
import {
  checkMpesaNumber,
  formatMpesaPhone,
  MpesaUnsupported,
  normalizeMpesaPhone,
  requestMpesaInvoiceKes,
  requestMpesaInvoiceSats,
  type MpesaCapability,
  type MpesaInvoice,
} from "../services/mpesa";
import * as wallet from "../services/wallet";
import { useWallet } from "../store/wallet";
import { Button, Card, Field, Notice, Screen, Text, success } from "../ui/components";
import { CopyField, NumPad, toast } from "../ui/extras";
import { KeyValue } from "../ui/rows";
import { space, useColors } from "../ui/theme";

type Step = "phone" | "amount" | "confirm" | "done";
type Unit = "sats" | "kes";

type Receipt = {
  phone: string;
  sats: bigint;
  feeSats: bigint;
  kesAmount?: number;
  receiptUrl?: string;
};

export function WithdrawScreen() {
  const nav = useNavigation<any>();
  const c = useColors();
  const balance = useWallet((s) => s.balance);
  const fiatOf = useFiatOf();

  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [cap, setCap] = useState<MpesaCapability | null>(null);
  const [unit, setUnit] = useState<Unit>("sats");
  const [amount, setAmount] = useState("0");
  const [prepared, setPrepared] = useState<wallet.PreparedSend | null>(null);
  const [invoice, setInvoice] = useState<MpesaInvoice | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep("phone");
    setPhoneInput("");
    setCap(null);
    setAmount("0");
    setPrepared(null);
    setInvoice(null);
    setReceipt(null);
    setError(null);
  };

  // -- 1. check the number ------------------------------------------------------
  const checkNumber = async () => {
    setError(null);
    const phone = normalizeMpesaPhone(phoneInput);
    if (!phone) {
      setError("Enter a Kenyan M-Pesa number, e.g. 0717 252303.");
      return;
    }
    setBusy(true);
    try {
      const result = await checkMpesaNumber(phone);
      setCap(result);
      setStep("amount");
    } catch (e) {
      setError(e instanceof MpesaUnsupported ? e.message : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // -- 2. request invoice + prepare payment ------------------------------------
  const review = async () => {
    if (!cap) return;
    setError(null);
    setBusy(true);
    try {
      let inv: MpesaInvoice;
      let kes: number | undefined;
      let sats: bigint;
      if (unit === "kes") {
        kes = Number(amount);
        if (!Number.isFinite(kes) || kes <= 0) throw new Error("Enter a KES amount.");
        inv = await requestMpesaInvoiceKes(cap.phone, kes);
      } else {
        sats = BigInt(amount);
        if (sats <= 0n) throw new Error("Enter an amount in sats.");
        inv = await requestMpesaInvoiceSats(cap.phone, sats);
      }

      const parsed = await wallet.parseInput(inv.pr);
      if (parsed.type !== "bolt11" || !parsed.amountSats) throw new Error("The bridge returned an unusable invoice.");
      const prep = await wallet.prepareSend(parsed);
      setInvoice(inv);
      setPrepared(prep);
      setStep("confirm");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // -- 3. pay ------------------------------------------------------------------
  const confirm = async () => {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      const tx = await prepared.send();
      success();
      void useWallet.getState().refresh();
      const kes = invoice?.convertedKes;
      const url = invoice?.successAction?.url;
      setReceipt({
        phone: formatMpesaPhone(cap!.phone),
        sats: prepared.amountSats,
        feeSats: prepared.feeSats,
        kesAmount: unit === "kes" ? Number(amount) : kes,
        receiptUrl: url,
      });
      setStep("done");
      if (tx.status === "complete") toast("Payment sent — M-Pesa is on its way", "success");
      else toast("Payment on its way", "success");
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  // -- render ------------------------------------------------------------------
  if (step === "phone") {
    return (
      <Screen
        back
        title="Withdraw to M-Pesa"
        footer={<Button title="Check number" loading={busy} disabled={!phoneInput.trim()} onPress={checkNumber} />}
      >
        <Text variant="heading">Send bitcoin, receive M-Pesa</Text>
        <Text variant="caption" muted>
          Enter a Kenyan M-Pesa phone number. The bridge sends shillings to that number once your payment confirms.
        </Text>
        <Field
          label="M-Pesa number"
          value={phoneInput}
          onChangeText={setPhoneInput}
          placeholder="0717 252303"
          keyboardType="phone-pad"
          autoCapitalize="none"
          autoCorrect={false}
          error={error}
          hint="Safaricom numbers only. Airtel isn't supported."
        />
      </Screen>
    );
  }

  if (step === "amount" && cap) {
    const satsVal = BigInt(amount);
    const kesVal = Number(amount);
    const tooMuch = unit === "sats" && balance !== null && satsVal > balance;
    const outOfRange = unit === "sats" && (satsVal < cap.minSats || satsVal > cap.maxSats);
    const canContinue = unit === "sats" ? satsVal >= cap.minSats && satsVal <= cap.maxSats && !tooMuch : kesVal > 0;
    return (
      <Screen
        back
        title="Amount"
        scroll={false}
        right={
          <View style={{ flexDirection: "row", borderRadius: 12, backgroundColor: c.surfaceAlt, padding: 4 }}>
            {(["sats", "kes"] as Unit[]).map((u) => (
              <Pressable
                key={u}
                onPress={() => {
                  setUnit(u);
                  setAmount("0");
                }}
                style={{
                  paddingHorizontal: 14,
                  height: 36,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: unit === u ? c.surface : "transparent",
                }}
              >
                <Text variant="label" color={unit === u ? c.text : c.textMuted}>
                  {u === "sats" ? "sats" : "KES"}
                </Text>
              </Pressable>
            ))}
          </View>
        }
        footer={<Button title="Review" loading={busy} disabled={!canContinue} onPress={review} />}
      >
        <Text variant="caption" muted center numberOfLines={1}>
          To {formatMpesaPhone(cap.phone)}
        </Text>
        <View style={{ alignItems: "center", gap: 4, paddingVertical: space.lg }}>
          <Text variant="hero">{Number(amount).toLocaleString()}</Text>
          <Text muted>{unit === "sats" ? "sats" : "KES"}{unit === "sats" && fiatOf(satsVal) ? ` · ${fiatOf(satsVal)}` : ""}</Text>
          {tooMuch && unit === "sats" && <Text variant="caption" color={c.danger}>More than your balance</Text>}
          {outOfRange && unit === "sats" && (
            <Text variant="caption" faint>
              Between {formatSats(cap.minSats)} and {formatSats(cap.maxSats)}
            </Text>
          )}
          {error && <Text variant="caption" color={c.danger}>{error}</Text>}
        </View>
        <View style={{ flex: 1 }} />
        <NumPad value={amount} onChange={setAmount} decimals={0} max={12} />
      </Screen>
    );
  }

  if (step === "confirm" && prepared && cap) {
    const total = prepared.amountSats + prepared.feeSats;
    const kesAmount = unit === "kes" ? Number(amount) : invoice?.convertedKes;
    return (
      <Screen
        back
        title="Confirm"
        footer={<Button title={`Send ${formatSats(prepared.amountSats)}`} loading={busy} onPress={confirm} />}
      >
        <View style={{ alignItems: "center", gap: 4, paddingVertical: space.xl }}>
          <Text variant="hero">{formatSats(prepared.amountSats)}</Text>
          {fiatOf(prepared.amountSats) && <Text muted>≈ {fiatOf(prepared.amountSats)}</Text>}
          {kesAmount && <Text variant="label" color={c.accent}>{formatFiat(kesAmount, "KES", 0)} to M-Pesa</Text>}
        </View>
        <Card>
          <KeyValue label="To" value={formatMpesaPhone(cap.phone)} />
          <KeyValue label="Network fee" value={formatSats(prepared.feeSats)} />
          <KeyValue label="Total" value={formatSats(total)} />
        </Card>
        {balance !== null && total > BigInt(balance) && <Notice tone="danger">Not enough balance for this payment and its fee.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        <Notice tone="info" icon="zap">
          The Lightning payment settles the invoice instantly. M-Pesa is sent to the number automatically.
        </Notice>
      </Screen>
    );
  }

  if (step === "done" && receipt) {
    return (
      <Screen back title="Sent" footer={<View style={{ gap: space.sm }}><Button title="Done" onPress={() => nav.goBack()} /><Button kind="secondary" title="Send to another number" onPress={reset} /></View>}>
        <View style={{ alignItems: "center", gap: space.md, paddingVertical: space.xl }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center" }}>
            <Feather name="check" size={30} color={c.primary} />
          </View>
          <Text variant="heading">{formatSats(receipt.sats)} sent</Text>
          {receipt.kesAmount && <Text variant="title" color={c.accent}>{formatFiat(receipt.kesAmount, "KES", 0)} → M-Pesa</Text>}
          <Text muted>{receipt.phone}</Text>
        </View>
        <Card>
          <KeyValue label="Amount" value={formatSats(receipt.sats)} />
          <KeyValue label="Network fee" value={formatSats(receipt.feeSats)} />
        </Card>
        {receipt.receiptUrl && (
          <View style={{ gap: space.sm }}>
            <Text variant="label">Receipt</Text>
            <CopyField value={receipt.receiptUrl} label="Payment receipt" short />
            <Button kind="secondary" icon="external-link" title="View receipt" onPress={() => void Linking.openURL(receipt.receiptUrl!)} />
          </View>
        )}
      </Screen>
    );
  }

  return null;
}
