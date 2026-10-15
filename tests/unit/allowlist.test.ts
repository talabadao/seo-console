import { describe, expect, it } from "vitest";
import { ALLOWED_EMAILS, isAllowedEmail, isAllowedIdentity } from "@/lib/auth/allowlist";

describe("sign-in allowlist", () => {
  it("contains exactly the two phase 1 accounts", () => {
    expect([...ALLOWED_EMAILS].sort()).toEqual(["analytics@artemisdigital.com", "analytics@headsonpillows.com"]);
  });

  it("accepts the listed accounts, ignoring case and surrounding spaces", () => {
    expect(isAllowedEmail("analytics@headsonpillows.com")).toBe(true);
    expect(isAllowedEmail(" Analytics@ArtemisDigital.com ")).toBe(true);
  });

  it("refuses other addresses at the same domains, and look-alikes", () => {
    for (const email of [
      "seo@headsonpillows.com",
      "analytics@sub.headsonpillows.com",
      "analytics@headsonpillows.com.evil.io",
      "analytics+x@headsonpillows.com",
      "tinledoihoa@gmail.com",
      "",
    ]) {
      expect(isAllowedEmail(email)).toBe(false);
    }
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
  });

  it("requires Google to have verified the address", () => {
    expect(isAllowedIdentity({ email: "analytics@headsonpillows.com", email_verified: true })).toBe(true);
    expect(isAllowedIdentity({ email: "analytics@headsonpillows.com", email_verified: false })).toBe(false);
    expect(isAllowedIdentity({ email: "analytics@headsonpillows.com" })).toBe(false);
    expect(isAllowedIdentity(null)).toBe(false);
  });
});
