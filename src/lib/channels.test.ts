import { channelInfo, channelsForCurrency, CURRENCIES, describeDetails, detailsComplete, validateDetails } from "./channels";

describe("channels", () => {
  it("uses versioned registry ids on the wire", () => {
    const ids = channelsForCurrency("KES").map((c) => c.id);
    expect(ids).toContain("mpesa_phone_ke_kes@2");
    expect(ids.every((id) => /^[a-z0-9_]+@\d+$/.test(id))).toBe(true);
  });

  it("resolves other schema revisions of a known channel", () => {
    expect(channelInfo("mpesa_phone_ke_kes@1").schema?.id).toBe("mpesa_phone_ke_kes");
    expect(channelInfo("mpesa_phone_ke_kes@1").id).toBe("mpesa_phone_ke_kes@2");
  });

  it("validates and normalizes details with the registry schema", () => {
    const check = validateDetails("mpesa_phone_ke_kes@2", { phoneNumber: "0712 345 678" });
    expect(check.valid).toBe(true);
    expect(check.data.phoneNumber).toBe("+254712345678");
    expect(detailsComplete("mpesa_phone_ke_kes@2", { phoneNumber: "12" })).toBe(false);
  });

  it("masks for display but copies the full value", () => {
    const [row] = describeDetails("mpesa_phone_ke_kes@2", { phoneNumber: "+254712345678" });
    expect(row.copyValue).toBe("+254712345678");
    expect(row.value).not.toBe("+254712345678");
  });

  it("needs no details for cash", () => {
    expect(detailsComplete("cash_ke_kes@2", {})).toBe(true);
  });

  it("falls back to free text for channels this build doesn't know", () => {
    const info = channelInfo("orange_money_sn_xof@1");
    expect(info.schema).toBeNull();
    expect(detailsComplete(info.id, { details: "pay +221 77 000 0000" })).toBe(true);
  });

  it("lists currencies with real payment rails first", () => {
    expect(CURRENCIES[0].code).toBe("KES");
    expect(CURRENCIES.find((c) => c.code === "KES")?.flag).toBe("🇰🇪");
  });
});
