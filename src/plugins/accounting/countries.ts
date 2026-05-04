// Country utilities for the accounting plugin.
//
// The book's country (ISO 3166-1 alpha-2) identifies the tax
// jurisdiction the book is kept under. The Accounting role uses it
// to give country-aware advice — Japanese T-number under
// インボイス制度, EU VAT ID, UK VAT, GSTIN, ABN, etc.
//
// Curated against the supported currency list and the tax-regime
// guidance in `src/config/roles.ts` (Accounting role prompt).
// Intl.DisplayNames provides the localized human name at render
// time, so this stays a flat list of codes.

/** ISO 3166-1 alpha-2 country codes shown in the book country
 *  dropdown. Curated to cover every jurisdiction the Accounting role
 *  has explicit tax-registration advice for, plus the major economies
 *  represented in `SUPPORTED_CURRENCY_CODES`. */
export const SUPPORTED_COUNTRY_CODES = [
  "US",
  "JP",
  "GB",
  "CA",
  "AU",
  "NZ",
  "DE",
  "FR",
  "IT",
  "ES",
  "NL",
  "BE",
  "AT",
  "IE",
  "PT",
  "FI",
  "SE",
  "DK",
  "PL",
  "CH",
  "NO",
  "CN",
  "KR",
  "TW",
  "HK",
  "SG",
  "IN",
  "BR",
  "MX",
] as const;

export type SupportedCountryCode = (typeof SUPPORTED_COUNTRY_CODES)[number];

/** EU member states as of 2026. Used by the role-prompt advice path
 *  to recommend a VAT identification number when the book country is
 *  in the EU. */
export const EU_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

/** Localized human name for a country code. Falls back to the code
 *  itself if the runtime can't resolve the name. */
export function localizedCountryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Runtime guard for `BookSummary.country`. The type is the union
 *  `SupportedCountryCode`, but every entry point that takes user /
 *  LLM input arrives as raw `string` (form submit, JSON-RPC body),
 *  so the service layer narrows here before persisting. */
export function isSupportedCountryCode(value: unknown): value is SupportedCountryCode {
  return typeof value === "string" && (SUPPORTED_COUNTRY_CODES as readonly string[]).includes(value);
}

/** Per-country tax-registration-ID requirement, used by the UI to
 *  decide whether to nudge the user when they leave the T-number
 *  / VAT ID field blank on a postable 14xx / 24xx line.
 *
 *  Mirrors the "Country-aware tax behaviour" prose in the
 *  Accounting role prompt (`src/config/roles.ts`). The two MUST
 *  stay in sync — drift means the LLM and the form give the user
 *  contradictory advice. The prompt is the source of truth for
 *  agent behaviour; this table is structured-data sibling for the
 *  form. */
export type TaxRegistrationRequirement = "required" | "recommended" | "none";

export const TAX_REGISTRATION_REQUIREMENT: Record<SupportedCountryCode, TaxRegistrationRequirement> = {
  // Explicitly required by the role prompt.
  JP: "required",
  GB: "required",
  DE: "required",
  FR: "required",
  IT: "required",
  ES: "required",
  NL: "required",
  BE: "required",
  AT: "required",
  IE: "required",
  PT: "required",
  FI: "required",
  SE: "required",
  DK: "required",
  PL: "required",
  IN: "required",
  AU: "required",
  NZ: "required",
  CA: "required",
  // Explicitly excluded — US has no federal sales-tax registration.
  US: "none",
  // "Other countries" bucket — prompt asks for the equivalent
  // local registration number but doesn't make it a hard rule.
  CH: "recommended",
  NO: "recommended",
  CN: "recommended",
  KR: "recommended",
  TW: "recommended",
  HK: "recommended",
  SG: "recommended",
  BR: "recommended",
  MX: "recommended",
};

/** Resolve the requirement level for a (possibly undefined) country
 *  code. Unset country still nudges — the user picked a 14xx / 24xx
 *  account, so something tax-related is happening; staying silent
 *  would replicate the silent-strip path the warning is meant to
 *  flag. */
export function taxRegistrationRequirement(country: SupportedCountryCode | undefined): TaxRegistrationRequirement {
  if (!country) return "recommended";
  return TAX_REGISTRATION_REQUIREMENT[country];
}
