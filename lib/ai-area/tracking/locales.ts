export const LANGUAGES = [
  ["en", "English"],
  ["vi", "Vietnamese"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["pt", "Portuguese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh-cn", "Chinese (Simplified)"],
  ["th", "Thai"],
] as const;

export const COUNTRIES = [
  ["us", "United States"],
  ["uk", "United Kingdom"],
  ["vn", "Vietnam"],
  ["au", "Australia"],
  ["ca", "Canada"],
  ["de", "Germany"],
  ["fr", "France"],
  ["jp", "Japan"],
  ["kr", "South Korea"],
  ["sg", "Singapore"],
  ["th", "Thailand"],
  ["in", "India"],
] as const;

export function countryName(code: string): string {
  return COUNTRIES.find(([c]) => c === code)?.[1] ?? code.toUpperCase();
}

/** "Google Mobile · Vietnam" - how a project's search setup is labelled across the tab. */
export function searchSetupLabel(settings: { device: string; country: string }): string {
  return `Google ${settings.device.charAt(0).toUpperCase()}${settings.device.slice(1)} · ${countryName(settings.country)}`;
}
