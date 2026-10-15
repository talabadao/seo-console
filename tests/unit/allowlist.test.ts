import { describe, expect, it } from "vitest";
import { ALLOWED_EMAILS, isAllowedEmail, isAllowedIdentity, normalizeEmail } from "@/lib/auth/allowlist";

const APPROVED = [
  "analytics@artemisdigital.com",
  "analytics@headsonpillows.com",
  "tin@artemisdigital.com",
  "tin@headsonpillows.com",
  "tinledoihoa@gmail.com",
];

describe("sign-in allowlist", () => {
  it("contains exactly the five phase 1 accounts", () => {
    expect([...ALLOWED_EMAILS].map(normalizeEmail).sort()).toEqual(APPROVED);
  });

  it("accepts every listed account", () => {
    for (const email of APPROVED) expect(isAllowedEmail(email)).toBe(true);
  });

  it("ignores letter case and surrounding whitespace", () => {
    expect(isAllowedEmail(" Analytics@ArtemisDigital.com ")).toBe(true);
    expect(isAllowedEmail("TIN@HEADSONPILLOWS.COM")).toBe(true);
    expect(isAllowedEmail("\tTinLeDoiHoa@Gmail.com\n")).toBe(true);
  });

  it("refuses other addresses at the same domains, and look-alikes", () => {
    for (const email of [
      "seo@headsonpillows.com",
      "tin2@artemisdigital.com",
      "analytics@sub.headsonpillows.com",
      "analytics@headsonpillows.com.evil.io",
      "analytics+x@headsonpillows.com",
      "tin@gmail.com",
      "tin.ledoihoa@gmail.com",
      "tinledoihoa@googlemail.com",
      "tin @headsonpillows.com",
      "",
      "   ",
    ]) {
      expect(isAllowedEmail(email), email).toBe(false);
    }
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
  });

  it("requires Google to have verified the address", () => {
    for (const email of ["analytics@headsonpillows.com", "tinledoihoa@gmail.com"]) {
      expect(isAllowedIdentity({ email, email_verified: true })).toBe(true);
      expect(isAllowedIdentity({ email, email_verified: false })).toBe(false);
      expect(isAllowedIdentity({ email })).toBe(false);
    }
    expect(isAllowedIdentity({ email: "someone@example.com", email_verified: true })).toBe(false);
    expect(isAllowedIdentity(null)).toBe(false);
  });
});
