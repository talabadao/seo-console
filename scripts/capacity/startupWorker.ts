// One server instance for startupCheck.ts: initializes lib/db exactly as the app does on its first query, reads
// existing data and, when asked, an encrypted account credential, and reports what it saw (never the secret).
import { db } from "@/lib/db";
import { readCredential, saveCredential } from "@/lib/credentials/store";

const mode = process.argv[2] ?? "read";
const t0 = performance.now();
try {
  const users = (await db.prepare("SELECT COUNT(*)::int AS n FROM users").get()) as { n: number };
  const out: Record<string, unknown> = { ok: true, users: users.n, ms: Math.round(performance.now() - t0) };
  if (mode === "save-credential") {
    await saveCredential(1, "serpapi", { apiKey: "startup-check-key-0001" });
    out.saved = true;
  }
  if (mode === "read" || mode === "save-credential") {
    const c = await readCredential(1, "serpapi");
    out.credentialReadable = c?.values.apiKey === "startup-check-key-0001";
  }
  console.log(JSON.stringify(out));
  process.exit(0);
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
}
