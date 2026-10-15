import { describe, expect, it } from "vitest";
import { DEMO_PROJECTS, demoProjectsAllowed } from "@/lib/previewDemo";

describe("preview demo projects", () => {
  it("are allowed only on Preview and in local development", () => {
    expect(demoProjectsAllowed("preview")).toBe(true);
    expect(demoProjectsAllowed("development")).toBe(true);
    expect(demoProjectsAllowed("production")).toBe(false);
  });

  it("use only the reserved .example top-level domain", () => {
    for (const p of DEMO_PROJECTS) expect(new URL(p.websiteUrl).hostname).toMatch(/.example$/);
  });
});
