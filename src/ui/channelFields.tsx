import { PaymentFieldType, type PaymentChannelField } from "@minmoto/payment-channels";
import React, { useState } from "react";
import { View } from "react-native";

import { channelInfo, validateDetails, type ChannelDetails } from "../lib/channels";
import { Chip, Field, Text } from "./components";
import { space } from "./theme";

const KEYBOARD: Partial<Record<PaymentFieldType, "phone-pad" | "number-pad">> = {
  [PaymentFieldType.Phone]: "phone-pad",
  [PaymentFieldType.Number]: "number-pad",
};

/**
 * Inputs for one channel's payment details, built from its registry schema.
 * Errors appear once a field has been left, so typing isn't interrupted.
 */
export function ChannelFields({ channel, value, onChange }: { channel: string; value: ChannelDetails; onChange: (d: ChannelDetails) => void }) {
  const info = channelInfo(channel);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const issues = validateDetails(channel, value).issues;
  const errorFor = (key: string) => (touched[key] ? (issues.find((i) => i.field === key)?.message ?? null) : null);

  if (!info.fields.length) {
    return (
      <Text variant="caption" muted>
        No details needed. Agree where to meet in the swap chat.
      </Text>
    );
  }
  return (
    <>
      {info.fields.map((f) => (
        <FieldInput
          key={f.key}
          field={f}
          value={value[f.key] ?? ""}
          error={errorFor(f.key)}
          onChange={(t) => onChange({ ...value, [f.key]: t })}
          onBlur={() => setTouched((s) => ({ ...s, [f.key]: true }))}
        />
      ))}
    </>
  );
}

function FieldInput({ field, value, error, onChange, onBlur }: { field: PaymentChannelField; value: string; error: string | null; onChange: (t: string) => void; onBlur: () => void }) {
  const label = field.required ? field.label : `${field.label} (optional)`;
  if (field.type === PaymentFieldType.Select && field.options?.length) {
    return (
      <View style={{ gap: 6 }}>
        <Text variant="label">{label}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {field.options.map((o) => (
            <Chip key={o.value} label={o.label} selected={value === o.value} onPress={() => onChange(o.value)} />
          ))}
        </View>
      </View>
    );
  }
  return (
    <Field
      label={label}
      placeholder={field.placeholder}
      hint={field.helpText}
      error={error}
      keyboardType={KEYBOARD[field.type] ?? "default"}
      autoCorrect={false}
      value={value}
      onChangeText={onChange}
      onBlur={onBlur}
    />
  );
}
