import { useNavigation } from "@react-navigation/native";
import React, { useEffect, useState } from "react";
import { Share, View } from "react-native";

import { useFiatOf } from "../hooks";
import { formatSats } from "../lib/money";
import * as wallet from "../services/wallet";
import { useSession } from "../store/session";
import { useWallet } from "../store/wallet";
import { Button, Card, Field, Notice, Screen, Segmented, Spinner, Text, success } from "../ui/components";
import { CopyField, NumPad, QR, Sheet, toast, toastError } from "../ui/extras";
import { space } from "../ui/theme";

type Tab = "lightning" | "onchain";

export function ReceiveScreen() {
  const nav = useNavigation<any>();
  const backedUp = useSession((s) => s.backedUp);
  const lnAddress = useWallet((s) => s.lightningAddress);
  const [tab, setTab] = useState<Tab>("lightning");
  const [amount, setAmount] = useState("0");
  const [invoice, setInvoice] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [amountOpen, setAmountOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const fiatOf = useFiatOf();

  const makeInvoice = async (sats: number) => {
    setBusy(true);
    try {
      setInvoice(await wallet.receiveInvoice(sats > 0 ? BigInt(sats) : undefined, "Pontspark"));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (tab === "lightning" && !invoice) void makeInvoice(0);
    if (tab === "onchain" && !address) {
      wallet.bitcoinAddress().then(setAddress).catch(toastError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Close automatically once the invoice is paid.
  useEffect(() => {
    if (!invoice) return;
    const startedAt = Math.floor(Date.now() / 1000);
    return wallet.onWalletEvent((e) => {
      if (e.type === "payment" && e.payment.direction === "in" && e.payment.status === "complete" && e.payment.timestamp >= startedAt - 5) {
        success();
        toast(`Received ${formatSats(e.payment.amountSats)}`, "success");
        nav.goBack();
      }
    });
  }, [invoice, nav]);

  const value = tab === "lightning" ? invoice : address;
  const sats = Number(amount);

  return (
    <Screen back title="Receive">
      {!backedUp && (
        <Notice tone="warning" title="Back up before you receive" action={<Button small kind="secondary" title="Back up now" onPress={() => nav.navigate("Backup")} />}>
          If you lose this phone without your recovery phrase, you lose this money.
        </Notice>
      )}
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "lightning", label: "Lightning" },
          { value: "onchain", label: "On-chain" },
        ]}
      />
      <Card style={{ alignItems: "center", gap: space.lg }}>
        {value && !busy ? <QR value={tab === "lightning" ? value.toUpperCase() : `bitcoin:${value}`} /> : <Spinner />}
        {tab === "lightning" && (
          <Text variant="heading" center>
            {sats > 0 ? formatSats(sats) : "Any amount"}
            {sats > 0 && fiatOf(sats) ? `  ·  ${fiatOf(sats)}` : ""}
          </Text>
        )}
        {tab === "onchain" && (
          <Text variant="caption" muted center>
            On-chain deposits take a few confirmations and carry a network fee.
          </Text>
        )}
      </Card>
      {value && <CopyField value={value} short label={tab === "lightning" ? "Invoice" : "Bitcoin address"} />}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {tab === "lightning" && (
          <Button style={{ flex: 1 }} kind="secondary" icon="edit-3" title="Amount" onPress={() => setAmountOpen(true)} />
        )}
        <Button
          style={{ flex: 1 }}
          kind="secondary"
          icon="share"
          title="Share"
          disabled={!value}
          onPress={() => void Share.share({ message: value ?? "" })}
        />
      </View>

      {tab === "lightning" && (
        <Card tone="alt">
          <Text variant="label">Lightning address</Text>
          {lnAddress ? (
            <CopyField value={lnAddress} />
          ) : (
            <>
              <Text variant="caption" muted>
                A reusable address like an email, so people can pay you any time.
              </Text>
              <Button small kind="secondary" title="Claim my address" onPress={() => setClaimOpen(true)} />
            </>
          )}
        </Card>
      )}

      <Sheet visible={amountOpen} onClose={() => setAmountOpen(false)} title="Request amount">
        <Text variant="display" center>
          {formatSats(Number(amount))}
        </Text>
        <Text variant="caption" muted center>
          {fiatOf(Number(amount)) ?? " "}
        </Text>
        <NumPad value={amount} onChange={setAmount} decimals={0} max={9} />
        <Button
          title="Done"
          onPress={() => {
            setAmountOpen(false);
            void makeInvoice(Number(amount));
          }}
        />
      </Sheet>
      <ClaimAddressSheet visible={claimOpen} onClose={() => setClaimOpen(false)} />
    </Screen>
  );
}

export function ClaimAddressSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const profileName = useSession((s) => s.profile.name);
  const [name, setName] = useState(profileName.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet visible={visible} onClose={onClose} title="Claim your address">
      <Field
        label="Username"
        value={name}
        onChangeText={(t) => {
          setName(t);
          setError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="satoshi"
        error={error}
      />
      <Button
        title="Claim"
        loading={busy}
        disabled={name.length < 3}
        onPress={async () => {
          setBusy(true);
          try {
            const a = await wallet.claimLightningAddress(name);
            useWallet.getState().setLightningAddress(a);
            success();
            toast(`You're ${a}`, "success");
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}
