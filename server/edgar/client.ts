// SEC EDGAR API client (host-side).
//
// Enforces the two non-negotiable rules of edgar.gov programmatic access:
//   1. Every request includes a User-Agent header with a contact address
//      (sourced from the plugin's config — the missing-config flow in
//      server/api/routes/edgar.ts handles the bootstrap).
//   2. Max 10 requests/second. We throttle to 9 to stay safely below.
//
// This module owns the throttle and ticker cache as module-level
// state — single Node process, so a single instance is correct.

import { log } from "../system/logger/index.js";

const LOG_PREFIX = "edgar";

const MIN_INTERVAL_MS = 1000 / 9; // ~111ms => 9 req/sec

const ALLOWED_HOSTS = new Set(["www.sec.gov", "data.sec.gov", "efts.sec.gov"]);

let lastRequestAt = 0;

interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

let tickerCache: Map<string, TickerEntry> | null = null;

export interface FilingSummary {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string;
  primaryDocument: string;
  primaryDocDescription: string;
}

export interface ResolvedCompany {
  cik: string;
  name: string;
  ticker?: string;
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, wait));
  }
  lastRequestAt = Date.now();
}

async function edgarFetch(url: string, userAgent: string): Promise<Response> {
  const { hostname } = new URL(url);
  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new Error(`edgar: refusing to fetch ${hostname} — only sec.gov hosts are allowed`);
  }
  await throttle();
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json, text/html;q=0.9",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`EDGAR ${response.status} for ${url}\n${body.slice(0, 500)}`);
  }
  return response;
}

/** Pad a numeric CIK to the 10-digit zero-padded form EDGAR uses. */
export function padCik(cik: string | number): string {
  return String(cik).replace(/^CIK/i, "").padStart(10, "0");
}

async function loadTickers(userAgent: string): Promise<Map<string, TickerEntry>> {
  if (tickerCache) return tickerCache;
  const response = await edgarFetch("https://www.sec.gov/files/company_tickers.json", userAgent);
  const data = (await response.json()) as Record<string, TickerEntry>;
  const map = new Map<string, TickerEntry>();
  for (const entry of Object.values(data)) {
    map.set(entry.ticker.toUpperCase(), entry);
  }
  tickerCache = map;
  return map;
}

export async function resolve(tickerOrCik: string, userAgent: string): Promise<ResolvedCompany> {
  const trimmed = tickerOrCik.trim();
  if (/^\d{1,10}$/.test(trimmed) || /^CIK\d+$/i.test(trimmed)) {
    return { cik: padCik(trimmed), name: "" };
  }
  const tickers = await loadTickers(userAgent);
  const hit = tickers.get(trimmed.toUpperCase());
  if (!hit) {
    throw new Error(`Ticker "${trimmed}" not found in SEC company_tickers.json. Pass a CIK directly if the company is foreign or delisted.`);
  }
  return { cik: padCik(hit.cik_str), name: hit.title, ticker: hit.ticker };
}

export async function getRecentFilings(
  cik: string,
  userAgent: string,
  opts: { formTypes?: string[]; limit?: number } = {},
): Promise<{ name: string; filings: FilingSummary[] }> {
  const response = await edgarFetch(`https://data.sec.gov/submissions/CIK${cik}.json`, userAgent);
  const data = (await response.json()) as {
    name: string;
    filings: {
      recent: {
        accessionNumber: string[];
        form: string[];
        filingDate: string[];
        reportDate: string[];
        primaryDocument: string[];
        primaryDocDescription: string[];
      };
    };
  };
  const { recent } = data.filings;
  const all: FilingSummary[] = recent.accessionNumber.map((_, idx) => ({
    accessionNumber: recent.accessionNumber[idx],
    form: recent.form[idx],
    filingDate: recent.filingDate[idx],
    reportDate: recent.reportDate[idx],
    primaryDocument: recent.primaryDocument[idx],
    primaryDocDescription: recent.primaryDocDescription[idx],
  }));
  const formTypes = opts.formTypes?.map((form) => form.toUpperCase());
  const filtered = formTypes ? all.filter((filing) => formTypes.includes(filing.form.toUpperCase())) : all;
  return { name: data.name, filings: filtered.slice(0, opts.limit ?? 25) };
}

export async function getFilingDocument(
  cik: string,
  accessionNumber: string,
  primaryDocument: string,
  userAgent: string,
): Promise<{ url: string; text: string }> {
  const accClean = accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accClean}/${primaryDocument}`;
  const response = await edgarFetch(url, userAgent);
  return { url, text: await response.text() };
}

export async function getCompanyFacts(cik: string, userAgent: string): Promise<unknown> {
  const response = await edgarFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, userAgent);
  return await response.json();
}

export async function getCompanyConcept(cik: string, taxonomy: string, concept: string, userAgent: string): Promise<unknown> {
  const response = await edgarFetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${concept}.json`, userAgent);
  return await response.json();
}

export async function fullTextSearch(
  query: string,
  userAgent: string,
  opts: { forms?: string[]; dateRange?: { from: string; to: string } } = {},
): Promise<unknown> {
  const params = new URLSearchParams({ q: query });
  if (opts.forms?.length) params.set("forms", opts.forms.join(","));
  if (opts.dateRange) {
    params.set("dateRange", "custom");
    params.set("startdt", opts.dateRange.from);
    params.set("enddt", opts.dateRange.to);
  }
  const response = await edgarFetch(`https://efts.sec.gov/LATEST/search-index?${params.toString()}`, userAgent);
  log.debug(LOG_PREFIX, "full-text search", { query, forms: opts.forms?.length });
  return await response.json();
}
