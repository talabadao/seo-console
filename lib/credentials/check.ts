// Non-billable connection checks for stored credentials. Each one reads an account or model listing that the
// provider doesn't charge for — never a search, generation or tracking job:
// - SerpApi:    GET https://serpapi.com/account.json            (free; reports the remaining searches)
// - OpenAI:     GET https://api.openai.com/v1/models             (lists models; uses no tokens)
// - Anthropic:  GET https://api.anthropic.com/v1/models          (lists models; uses no tokens)
// - DataForSEO: GET https://api.dataforseo.com/v3/appendix/user_data  (Basic auth with the API login and API
//               password; "Your account will not be charged for using this API")
// The result is stored separately from the saved state ("verified" vs "saved").

import type { CredentialProvider } from "./providers";

export interface CheckOutcome {
  ok: boolean;
  message: string;
}

const TIMEOUT = 20_000;

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function authFailure(status: number, provider: string): string {
  return status === 401 || status === 403 ? `${provider} rejected the credential (HTTP ${status}).` : `${provider} answered HTTP ${status}.`;
}

export async function checkCredential(provider: CredentialProvider, values: Record<string, string>): Promise<CheckOutcome> {
  try {
    if (provider === "serpapi") {
      const res = await fetch(`https://serpapi.com/account.json?${new URLSearchParams({ api_key: values.apiKey })}`, { signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
      const d = await json(res);
      if (!res.ok || typeof d.error === "string") return { ok: false, message: typeof d.error === "string" ? `SerpApi: ${d.error}` : authFailure(res.status, "SerpApi") };
      const left = typeof d.total_searches_left === "number" ? d.total_searches_left : null;
      return { ok: true, message: left == null ? "SerpApi accepted the key." : `SerpApi accepted the key; ${left.toLocaleString("en-US")} searches left on that account.` };
    }
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${values.apiKey}` }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
      if (!res.ok) return { ok: false, message: authFailure(res.status, "OpenAI") };
      const d = await json(res);
      return { ok: true, message: `OpenAI accepted the key (${Array.isArray(d.data) ? d.data.length : "some"} models available).` };
    }
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": values.apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(TIMEOUT),
        cache: "no-store",
      });
      if (!res.ok) return { ok: false, message: authFailure(res.status, "Anthropic") };
      const d = await json(res);
      return { ok: true, message: `Anthropic accepted the key (${Array.isArray(d.data) ? d.data.length : "some"} models available).` };
    }
    const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
      headers: { Authorization: `Basic ${Buffer.from(`${values.login}:${values.password}`).toString("base64")}` },
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const d = await json(res);
    if (!res.ok || (typeof d.status_code === "number" && d.status_code !== 20000)) {
      return { ok: false, message: typeof d.status_message === "string" ? `DataForSEO: ${d.status_message}` : authFailure(res.status, "DataForSEO") };
    }
    const task = (Array.isArray(d.tasks) ? d.tasks[0] : null) as { result?: Array<{ money?: { balance?: number } }> } | null;
    const balance = task?.result?.[0]?.money?.balance;
    return { ok: true, message: typeof balance === "number" ? `DataForSEO accepted the credentials; balance $${balance.toFixed(2)}.` : "DataForSEO accepted the credentials." };
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, message: timeout ? "The provider didn't answer in time; try again." : `Couldn't reach the provider: ${e instanceof Error ? e.message : String(e)}` };
  }
}
