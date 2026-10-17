// Admission (docs/seo-console-v2/WORKSPACE-MEMBERS.md, section 3): decided on Google's verified ID-token claims.
// Company Workspace accounts at exactly the two domains (with Google's hosted-domain claim) and one named Gmail
// exception may sign in; the shared analytics accounts are data connections only; everything else is refused.
import { describe, expect, it } from "vitest";
import { connectionEligibility, personalEligibility, storedIdentityEligible } from "@/lib/auth/eligibility";

const ISS = "https://accounts.google.com";
const claims = (email: string, hd?: string, extra: Record<string, unknown> = {}) => ({ iss: ISS, sub: `sub-${email}`, email, email_verified: true, ...(hd ? { hd } : {}), ...extra });

describe("personal sign-in", () => {
  it("admits verified company accounts whose hosted domain matches, in any letter case", () => {
    expect(personalEligibility(claims("person@artemisdigital.com", "artemisdigital.com")).ok).toBe(true);
    expect(personalEligibility(claims("Person@HeadsOnPillows.com", "headsonpillows.com")).ok).toBe(true);
    const r = personalEligibility(claims("  Mixed@ArtemisDigital.COM ", "artemisdigital.com"));
    expect(r.ok && r.identity.email).toBe("mixed@artemisdigital.com");
  });

  it("admits the one named Gmail exception, and no other Gmail account", () => {
    expect(personalEligibility(claims("tinledoihoa@gmail.com")).ok).toBe(true);
    for (const email of ["someone@gmail.com", "tinledoihoa+x@gmail.com", "tin.ledoihoa@gmail.com", "tinledoihoa@googlemail.com"]) {
      expect(personalEligibility(claims(email)), email).toMatchObject({ ok: false });
    }
  });

  it("refuses look-alike domains, sub-domains and a hosted-domain mismatch", () => {
    for (const [email, hd] of [
      ["person@artemisdigital.co", "artemisdigital.co"],
      ["person@artemis-digital.com", "artemis-digital.com"],
      ["person@mail.artemisdigital.com", "mail.artemisdigital.com"],
      ["person@artemisdigital.com.evil.io", "artemisdigital.com.evil.io"],
      ["person@headsonpillows.com", undefined],
      ["person@headsonpillows.com", "artemisdigital.com"],
      ["person@artemisdigital.com", "headsonpillows.com"],
    ] as const) {
      expect(personalEligibility(claims(email, hd)), `${email} hd=${hd}`).toMatchObject({ ok: false });
    }
  });

  it("refuses an unverified address, a missing subject or an unknown issuer", () => {
    expect(personalEligibility({ ...claims("person@artemisdigital.com", "artemisdigital.com"), email_verified: false })).toEqual({ ok: false, reason: "unverified" });
    expect(personalEligibility({ ...claims("person@artemisdigital.com", "artemisdigital.com"), sub: "" })).toEqual({ ok: false, reason: "bad-token" });
    expect(personalEligibility({ ...claims("person@artemisdigital.com", "artemisdigital.com"), iss: "https://evil.example" })).toEqual({ ok: false, reason: "bad-token" });
    expect(personalEligibility(null)).toEqual({ ok: false, reason: "bad-token" });
  });

  it("never lets the shared analytics accounts sign in as a person", () => {
    expect(personalEligibility(claims("analytics@artemisdigital.com", "artemisdigital.com"))).toEqual({ ok: false, reason: "shared-account" });
    expect(personalEligibility(claims("ANALYTICS@headsonpillows.com", "headsonpillows.com"))).toEqual({ ok: false, reason: "shared-account" });
  });

  it("rechecks stored identities with the same rules on every request", () => {
    expect(storedIdentityEligible({ email: "person@artemisdigital.com", hosted_domain: "artemisdigital.com" })).toBe(true);
    expect(storedIdentityEligible({ email: "person@artemisdigital.com", hosted_domain: null })).toBe(false);
    expect(storedIdentityEligible({ email: "analytics@artemisdigital.com", hosted_domain: "artemisdigital.com" })).toBe(false);
  });
});

describe("Google data connections", () => {
  it("accepts the shared analytics accounts (with their hosted domain) and team members' own eligible accounts", () => {
    expect(connectionEligibility(claims("analytics@artemisdigital.com", "artemisdigital.com"))).toMatchObject({ ok: true, shared: true });
    expect(connectionEligibility(claims("analytics@headsonpillows.com", "headsonpillows.com"))).toMatchObject({ ok: true, shared: true });
    expect(connectionEligibility(claims("tinledoihoa@gmail.com"))).toMatchObject({ ok: true, shared: false });
    expect(connectionEligibility(claims("person@headsonpillows.com", "headsonpillows.com"))).toMatchObject({ ok: true, shared: false });
  });

  it("refuses arbitrary accounts and an analytics address without its hosted domain", () => {
    expect(connectionEligibility(claims("someone@gmail.com"))).toMatchObject({ ok: false });
    expect(connectionEligibility(claims("analytics@artemisdigital.com"))).toMatchObject({ ok: false, reason: "domain-mismatch" });
  });
});
