// POST /api/edgar — single MCP-bridge dispatch route for the
// SEC EDGAR built-in plugin. The MCP server forwards every
// `edgar` tool call here verbatim; this handler validates the
// `kind` discriminator with Zod and routes to the matching
// client method.
//
// Self-healing config flow: when the SEC-required contact info
// is missing the route returns a structured `config_required`
// payload (HTTP 200) instead of throwing. The LLM reads the
// payload, asks the user for name + email, writes the config
// file via its built-in Write tool, and retries the original
// tool call.

import { Router, Request, Response } from "express";
import { z } from "zod";

import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { bindRoute } from "../../utils/router.js";
import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { serverError } from "../../utils/httpError.js";
import { missingConfigResponse, readConfig, userAgentFromConfig } from "../../edgar/config.js";
import { fullTextSearch, getCompanyConcept, getCompanyFacts, getFilingDocument, getRecentFilings, resolve } from "../../edgar/client.js";

const router = Router();

// SEC accession number canonical form: 10-digit filer prefix +
// 2-digit year + 6-digit sequence (`0000320193-24-000123`). The
// 18-digit dashless variant the URL uses is derived from this.
// Pinning the format here blocks `/`, `..`, `?`, `#` and other
// path-injection vectors before they reach URL construction.
const ACCESSION_NUMBER_RE = /^\d{10}-\d{2}-\d{6}$/;

// SEC primary-document filenames are kebab-case alphanumerics
// with extensions like `.htm` / `.html` / `.xml` / `.txt`. Reject
// anything that could escape the filing directory: no path
// separators, no `..` traversal, no query / fragment markers.
const PRIMARY_DOCUMENT_RE = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// XBRL concept identifiers are PascalCase alphanumeric tokens
// (e.g. `Revenues`, `NetIncomeLoss`, `EarningsPerShareBasic`).
// The SEC accepts underscores in some taxonomies. Pin the shape
// so a value containing `/`, `..`, `?`, or `#` can't rewrite the
// `data.sec.gov/api/xbrl/companyconcept/...` URL path.
const CONCEPT_RE = /^[A-Za-z]\w*$/;

// Exported for `test/edgar/test_args_validation.ts` so the regex
// guards (accession_number, primary_document, concept) and the
// both-or-neither date refinement are pinned by unit tests, not
// only end-to-end via HTTP.
export const Args = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lookup_cik"),
    ticker: z.string().min(1),
  }),
  z.object({
    kind: z.literal("get_recent_filings"),
    company: z.string().min(1),
    form_types: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(200).default(25),
  }),
  z.object({
    kind: z.literal("get_filing_document"),
    company: z.string().min(1),
    accession_number: z.string().regex(ACCESSION_NUMBER_RE, "accession_number must match NNNNNNNNNN-NN-NNNNNN"),
    primary_document: z.string().regex(PRIMARY_DOCUMENT_RE, "primary_document must be a bare filename (no path separators or `..`)"),
    max_chars: z.number().int().min(1000).max(500000).default(20000),
  }),
  z.object({
    kind: z.literal("get_company_facts"),
    company: z.string().min(1),
  }),
  z.object({
    kind: z.literal("get_concept"),
    company: z.string().min(1),
    concept: z.string().regex(CONCEPT_RE, "concept must be an XBRL identifier (alphanumeric, starts with a letter)"),
    taxonomy: z.enum(["us-gaap", "ifrs-full", "dei", "srt"]).default("us-gaap"),
  }),
  z
    .object({
      kind: z.literal("search_filings"),
      query: z.string().min(1),
      forms: z.array(z.string()).optional(),
      from_date: z.string().regex(ISO_DATE_RE).optional(),
      to_date: z.string().regex(ISO_DATE_RE).optional(),
    })
    // One-sided date bounds were silently dropped before — the
    // search ran unbounded and the caller saw broader results
    // than they asked for. Both-or-neither is explicit; partial
    // ranges 400.
    .refine((val) => Boolean(val.from_date) === Boolean(val.to_date), {
      message: "from_date and to_date must be provided together (or both omitted)",
    }),
]);

type EdgarArgs = z.infer<typeof Args>;

// Per-kind handlers, kept tiny so the dispatcher is well under
// the 20-line cap and each kind can be tested in isolation.

async function handleLookupCik(args: Extract<EdgarArgs, { kind: "lookup_cik" }>, userAgent: string): Promise<unknown> {
  return await resolve(args.ticker, userAgent);
}

async function handleRecentFilings(args: Extract<EdgarArgs, { kind: "get_recent_filings" }>, userAgent: string): Promise<unknown> {
  const { cik, name, ticker } = await resolve(args.company, userAgent);
  const result = await getRecentFilings(cik, userAgent, { formTypes: args.form_types, limit: args.limit });
  return { cik, ticker, resolvedName: name, ...result };
}

async function handleFilingDocument(args: Extract<EdgarArgs, { kind: "get_filing_document" }>, userAgent: string): Promise<unknown> {
  const { cik } = await resolve(args.company, userAgent);
  const { url, text } = await getFilingDocument(cik, args.accession_number, args.primary_document, userAgent);
  const truncated = text.length > args.max_chars ? `${text.slice(0, args.max_chars)}\n\n[... truncated ${text.length - args.max_chars} more chars ...]` : text;
  return { url, length: text.length, content: truncated };
}

async function handleCompanyFacts(args: Extract<EdgarArgs, { kind: "get_company_facts" }>, userAgent: string): Promise<unknown> {
  const { cik } = await resolve(args.company, userAgent);
  return await getCompanyFacts(cik, userAgent);
}

async function handleConcept(args: Extract<EdgarArgs, { kind: "get_concept" }>, userAgent: string): Promise<unknown> {
  const { cik } = await resolve(args.company, userAgent);
  return await getCompanyConcept(cik, args.taxonomy, args.concept, userAgent);
}

async function handleSearchFilings(args: Extract<EdgarArgs, { kind: "search_filings" }>, userAgent: string): Promise<unknown> {
  const dateRange = args.from_date && args.to_date ? { from: args.from_date, to: args.to_date } : undefined;
  return await fullTextSearch(args.query, userAgent, { forms: args.forms, dateRange });
}

async function dispatch(args: EdgarArgs, userAgent: string): Promise<unknown> {
  switch (args.kind) {
    case "lookup_cik":
      return handleLookupCik(args, userAgent);
    case "get_recent_filings":
      return handleRecentFilings(args, userAgent);
    case "get_filing_document":
      return handleFilingDocument(args, userAgent);
    case "get_company_facts":
      return handleCompanyFacts(args, userAgent);
    case "get_concept":
      return handleConcept(args, userAgent);
    case "search_filings":
      return handleSearchFilings(args, userAgent);
    default: {
      const exhaustive: never = args;
      throw new Error(`unknown edgar kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// The MCP bridge (server/agent/mcp-server.ts:handleToolCall)
// surfaces only `message` + `instructions` to the LLM and drops
// every other top-level field. We embed the structured payload
// (path, schema) into `instructions` as a JSON-tagged block so
// the LLM both reads the prose AND can parse the path/schema
// values out without us setting `data` (which would trigger a
// frontend canvas push — not wanted for a pure-API plugin).
function respondMissingConfig(res: Response): void {
  const payload = missingConfigResponse();
  res.json({
    instructions: `${payload.instructions}\n\nDetails (JSON):\n${JSON.stringify({ path: payload.path, schema: payload.schema }, null, 2)}`,
  });
}

bindRoute(router, API_ROUTES.edgar.dispatch, async (req: Request<object, unknown, unknown>, res: Response) => {
  const parsed = Args.safeParse(req.body);
  if (!parsed.success) {
    log.warn("edgar", "POST dispatch: invalid body", { issue: parsed.error.issues[0]?.message });
    res.status(400).json({ error: `invalid edgar arguments: ${parsed.error.issues.map((i) => i.message).join("; ")}` });
    return;
  }
  const args = parsed.data;
  log.info("edgar", "POST dispatch: start", { kind: args.kind });

  const cfg = readConfig();
  if (!cfg) {
    log.info("edgar", "POST dispatch: config missing — returning self-healing payload");
    respondMissingConfig(res);
    return;
  }

  try {
    const result = await dispatch(args, userAgentFromConfig(cfg));
    log.info("edgar", "POST dispatch: ok", { kind: args.kind });
    res.json({ message: JSON.stringify(result) });
  } catch (err) {
    log.error("edgar", "POST dispatch: threw", { kind: args.kind, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

export default router;
