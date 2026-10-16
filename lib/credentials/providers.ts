// The API credentials an account can store, with the fields each provider's API actually authenticates with.
// Shared by the server store and the Settings page (no server imports here).

export type CredentialProvider = "serpapi" | "openai" | "anthropic" | "dataforseo";

export interface CredentialFieldSpec {
  name: string;
  label: string;
  /** Secret fields are never shown again; non-secret fields (a DataForSEO login) are shown masked. */
  secret: boolean;
  placeholder: string;
}

export interface ProviderSpec {
  id: CredentialProvider;
  label: string;
  /** What it's used for in SEO Console. */
  usedFor: string;
  fields: CredentialFieldSpec[];
  docsHref: string;
  /** How "Check" verifies the credential without spending anything. */
  checkNote: string;
}

export const CREDENTIAL_PROVIDERS: ProviderSpec[] = [
  {
    id: "serpapi",
    label: "SerpApi",
    usedFor: "Google Search Tracking, Rank tracking → Google, Brand Mentions (Google AI Mode / AI Overview) and Maps reviews.",
    fields: [{ name: "apiKey", label: "API key", secret: true, placeholder: "Paste the key from serpapi.com → API key" }],
    docsHref: "https://serpapi.com/manage-api-key",
    checkNote: "Reads your SerpApi account (free; no search is used).",
  },
  {
    id: "openai",
    label: "OpenAI API",
    usedFor: "Brand Mentions (ChatGPT answers and answer analysis) and review classification. This is an OpenAI Platform API key, not a ChatGPT login.",
    fields: [{ name: "apiKey", label: "API key", secret: true, placeholder: "sk-… from platform.openai.com → API keys" }],
    docsHref: "https://platform.openai.com/api-keys",
    checkNote: "Lists the models available to the key (no tokens are used).",
  },
  {
    id: "anthropic",
    label: "Anthropic API (Claude)",
    usedFor: "Brand Mentions (Claude answers).",
    fields: [{ name: "apiKey", label: "API key", secret: true, placeholder: "sk-ant-… from console.anthropic.com → API keys" }],
    docsHref: "https://console.anthropic.com/settings/keys",
    checkNote: "Lists the models available to the key (no tokens are used).",
  },
  {
    id: "dataforseo",
    label: "DataForSEO API",
    usedFor: "Account balance in Usage & Costs. DataForSEO data modules aren't connected yet.",
    fields: [
      { name: "login", label: "API login", secret: false, placeholder: "API login (from the DataForSEO API Access page)" },
      { name: "password", label: "API password", secret: true, placeholder: "API password (not your account password)" },
    ],
    docsHref: "https://app.dataforseo.com/api-access",
    checkNote: "Reads your DataForSEO user data and balance (free).",
  },
];

export const providerSpec = (id: string): ProviderSpec | undefined => CREDENTIAL_PROVIDERS.find((p) => p.id === id);

/** Status of one stored credential as the Settings page sees it — never the secret. */
export interface CredentialStatus {
  provider: CredentialProvider;
  saved: boolean;
  hint: string | null;
  updatedAt: number | null;
  /** Last connection check: "ok" | "failed", or null when not checked since the credential was saved. */
  verifyStatus: "ok" | "failed" | null;
  verifiedAt: number | null;
  verifyMessage: string | null;
  /** Where the effective credential comes from when it isn't the account's own (a legacy server key). */
  source: "account" | "server-legacy" | null;
}
