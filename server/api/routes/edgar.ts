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

const Args = z.discriminatedUnion("kind", [
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
    accession_number: z.string().min(1),
    primary_document: z.string().min(1),
    max_chars: z.number().int().min(1000).max(500000).default(20000),
  }),
  z.object({
    kind: z.literal("get_company_facts"),
    company: z.string().min(1),
  }),
  z.object({
    kind: z.literal("get_concept"),
    company: z.string().min(1),
    concept: z.string().min(1),
    taxonomy: z.enum(["us-gaap", "ifrs-full", "dei", "srt"]).default("us-gaap"),
  }),
  z.object({
    kind: z.literal("search_filings"),
    query: z.string().min(1),
    forms: z.array(z.string()).optional(),
    from_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
]);

type EdgarArgs = z.infer<typeof Args>;

async function dispatch(args: EdgarArgs, userAgent: string): Promise<unknown> {
  switch (args.kind) {
    case "lookup_cik":
      return await resolve(args.ticker, userAgent);
    case "get_recent_filings": {
      const { cik, name, ticker } = await resolve(args.company, userAgent);
      const result = await getRecentFilings(cik, userAgent, { formTypes: args.form_types, limit: args.limit });
      return { cik, ticker, resolvedName: name, ...result };
    }
    case "get_filing_document": {
      const { cik } = await resolve(args.company, userAgent);
      const { url, text } = await getFilingDocument(cik, args.accession_number, args.primary_document, userAgent);
      const truncated =
        text.length > args.max_chars ? `${text.slice(0, args.max_chars)}\n\n[... truncated ${text.length - args.max_chars} more chars ...]` : text;
      return { url, length: text.length, content: truncated };
    }
    case "get_company_facts": {
      const { cik } = await resolve(args.company, userAgent);
      return await getCompanyFacts(cik, userAgent);
    }
    case "get_concept": {
      const { cik } = await resolve(args.company, userAgent);
      return await getCompanyConcept(cik, args.taxonomy, args.concept, userAgent);
    }
    case "search_filings": {
      const dateRange = args.from_date && args.to_date ? { from: args.from_date, to: args.to_date } : undefined;
      return await fullTextSearch(args.query, userAgent, { forms: args.forms, dateRange });
    }
    default: {
      const exhaustive: never = args;
      throw new Error(`unknown edgar kind: ${JSON.stringify(exhaustive)}`);
    }
  }
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
    // The MCP bridge (server/agent/mcp-server.ts:handleToolCall)
    // surfaces only `message` + `instructions` to the LLM and drops
    // every other top-level field. We embed the structured payload
    // (path, schema) into `instructions` as a JSON-tagged block so
    // the LLM both reads the prose AND can parse the path/schema
    // values out without us setting `data` (which would trigger a
    // frontend canvas push — not wanted for a pure-API plugin).
    const payload = missingConfigResponse();
    res.json({
      instructions: `${payload.instructions}\n\nDetails (JSON):\n${JSON.stringify({ path: payload.path, schema: payload.schema }, null, 2)}`,
    });
    return;
  }

  const userAgent = userAgentFromConfig(cfg);
  try {
    const result = await dispatch(args, userAgent);
    log.info("edgar", "POST dispatch: ok", { kind: args.kind });
    // Same constraint as above: the MCP bridge only forwards
    // `message` + `instructions`. Stringify the result into
    // `message` so the LLM actually receives the EDGAR data.
    res.json({ message: JSON.stringify(result) });
  } catch (err) {
    log.error("edgar", "POST dispatch: threw", { kind: args.kind, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

export default router;
