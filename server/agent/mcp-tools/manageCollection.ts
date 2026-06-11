// `manageCollection` is the agent's data plane for schema-driven
// collections — the paved road over the same record files that raw
// Read/Write/Edit reach (the workspace stays the database; this tool is
// a convenience + gate, not a second store):
//
//   - getItems: records WITH the host-computed fields the stored JSON
//     never contains — `derived` formulas evaluated (cross-collection
//     derefs included), `toggle` projected, `embed` resolved — i.e. the
//     same numbers the user sees rendered. One call instead of N file
//     Reads plus a mental join.
//   - putItems: rows validated against the schema BEFORE the write
//     (primaryKey↔id, required fields, enum membership, no computed
//     keys), written atomically, with per-row accept/reject results the
//     model can fix and retry — instead of writing a broken file and
//     meeting it later in the presentCollection repair loop.
//
// Like `spawnBackgroundChat`, the workspace lookups are injected so the
// unit test can point everything at a tmpdir workspace; the production
// singleton binds the live modules with default (real-workspace) opts.

import {
  COMPUTED_TYPES,
  enrichItems,
  listItems,
  loadCollection,
  readItem,
  resolveCreateItemId,
  validateCollectionRecords,
  validateRecordObject,
  writeItem,
} from "../../workspace/collections/index.js";
import type { CollectionItem, CollectionSchema, LoadedCollection } from "../../workspace/collections/index.js";
import type { DiscoveryOptions } from "../../workspace/collections/discovery.js";
import { defangForPrompt } from "../../../src/utils/promptSafety.js";

/** Refuse an unselective getItems beyond this many records — a silent
 *  truncation would read as "covered everything", and an unbounded dump
 *  of a large collection is a token bomb. `ids` or `fields` lifts it. */
export const MAX_UNSELECTIVE_ITEMS = 200;

/** Workspace-targeting overrides, threaded to every collections call.
 *  Production: `{}` (live workspace). Tests: a tmpdir + empty user
 *  skills dir. */
export type ManageCollectionDeps = DiscoveryOptions;

interface GetItemsArgs {
  slug: string;
  ids?: string[];
  fields?: string[];
}

interface PutItemsArgs {
  slug: string;
  items: CollectionItem[];
  mode: "upsert" | "create";
}

function optionalStringArray(value: unknown, name: string): { ok: true; value?: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.length > 0)) {
    return { ok: false, error: `manageCollection: \`${name}\` must be an array of non-empty strings when present.` };
  }
  return { ok: true, value: value as string[] };
}

/** Project a record down to the requested fields. The primary key is
 *  always kept so every returned record stays addressable for a
 *  follow-up getItems/putItems. */
function projectFields(record: CollectionItem, fields: string[], primaryKey: string): CollectionItem {
  const keys = fields.includes(primaryKey) ? fields : [primaryKey, ...fields];
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

/** The validation warning appended to a getItems result when stored
 *  record files are malformed (they're silently skipped at read time,
 *  so without this they'd just look missing). Issue strings quote
 *  record-controlled text → defanged, mirroring the presentCollection
 *  dispatch. The record VALUES in `items` ride verbatim, like a raw
 *  file Read — only host-composed report strings are defanged. */
async function recordIssuesWarning(collection: LoadedCollection, deps: ManageCollectionDeps): Promise<string | undefined> {
  const issues = await validateCollectionRecords(collection, { workspaceRoot: deps.workspaceRoot });
  if (issues.length === 0) return undefined;
  const lines = issues.map((issue) => `- ${defangForPrompt(issue.file)}: ${defangForPrompt(issue.problem)}`).join("\n");
  return `${issues.length} record file(s) have data problems and are missing from this result. Fix each (Read → correct → Write):\n${lines}`;
}

async function loadRequestedItems(
  collection: LoadedCollection,
  ids: string[] | undefined,
  deps: ManageCollectionDeps,
): Promise<{ items: CollectionItem[]; missing: string[] }> {
  if (!ids) return { items: await listItems(collection.dataDir, { workspaceRoot: deps.workspaceRoot }), missing: [] };
  const items: CollectionItem[] = [];
  const missing: string[] = [];
  for (const recordId of ids) {
    const item = await readItem(collection.dataDir, recordId, { workspaceRoot: deps.workspaceRoot });
    if (item) items.push(item);
    else missing.push(recordId);
  }
  return { items, missing };
}

async function handleGetItems(collection: LoadedCollection, args: GetItemsArgs, deps: ManageCollectionDeps): Promise<string> {
  const { items, missing } = await loadRequestedItems(collection, args.ids, deps);
  if (!args.ids && !args.fields && items.length > MAX_UNSELECTIVE_ITEMS) {
    return `manageCollection: refused — '${collection.slug}' has ${items.length} records, over the unselective limit of ${MAX_UNSELECTIVE_ITEMS}. Pass \`ids\` for specific records or \`fields\` to project only the columns you need.`;
  }
  const enriched = await enrichItems(collection, items, deps);
  const projected = args.fields ? enriched.map((item) => projectFields(item, args.fields as string[], collection.schema.primaryKey)) : enriched;
  const warning = await recordIssuesWarning(collection, deps);
  return JSON.stringify({
    collection: collection.slug,
    count: projected.length,
    items: projected,
    ...(missing.length > 0 ? { missing: missing.map((recordId) => defangForPrompt(recordId)) } : {}),
    ...(warning ? { warning } : {}),
  });
}

/** Reject writes that set host-computed keys, with a pointer at the
 *  writable source of truth (the toggle's enum) where one exists. */
function computedKeyProblem(record: CollectionItem, schema: CollectionSchema): string | null {
  for (const key of Object.keys(record)) {
    const spec = schema.fields[key];
    if (!spec || !COMPUTED_TYPES.has(spec.type)) continue;
    if (spec.type === "toggle" && spec.field) return `'${key}' is a toggle projection — write the enum field '${spec.field}' instead`;
    return `'${key}' is ${spec.type === "derived" ? "derived" : "an embed"} — computed by the host, remove it from the record`;
  }
  return null;
}

interface RejectedRow {
  id: string;
  problem: string;
}

async function putOneItem(
  collection: LoadedCollection,
  record: CollectionItem,
  mode: "upsert" | "create",
  deps: ManageCollectionDeps,
): Promise<{ written?: string; rejected?: RejectedRow }> {
  const { schema } = collection;
  const itemId = resolveCreateItemId(schema, record);
  const reject = (about: string, problem: string): { rejected: RejectedRow } => ({
    rejected: { id: defangForPrompt(about), problem: defangForPrompt(problem) },
  });
  if (itemId === null) return reject("(no id)", `record has no '${schema.primaryKey}' value — set it (it doubles as the filename)`);
  const computed = computedKeyProblem(record, schema);
  if (computed) return reject(itemId, computed);
  const invalid = validateRecordObject(record, itemId, schema);
  if (invalid) return reject(itemId, invalid);
  const result = await writeItem(collection.dataDir, itemId, record, { refuseOverwrite: mode === "create", workspaceRoot: deps.workspaceRoot });
  if (result.kind === "ok") return { written: result.itemId };
  if (result.kind === "invalid-id") return reject(itemId, `'${itemId}' is not a valid record id (letters/digits with - or _ inside, no path characters)`);
  if (result.kind === "conflict") return reject(itemId, `'${itemId}' already exists — mode "create" refuses overwrite; use "upsert" to update it`);
  return reject(itemId, "write refused: the collection's data dir escapes the workspace");
}

async function handlePutItems(collection: LoadedCollection, args: PutItemsArgs, deps: ManageCollectionDeps): Promise<string> {
  const written: string[] = [];
  const rejected: RejectedRow[] = [];
  for (const record of args.items) {
    const outcome = await putOneItem(collection, record, args.mode, deps);
    if (outcome.written) written.push(outcome.written);
    if (outcome.rejected) rejected.push(outcome.rejected);
  }
  return JSON.stringify({ collection: collection.slug, written, rejected });
}

function parsePutItems(args: Record<string, unknown>, slug: string): PutItemsArgs | string {
  const { items, mode } = args;
  const validItems = Array.isArray(items) && items.length > 0 && items.every((entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  if (!validItems) return "manageCollection: `items` is required for putItems — a non-empty array of record objects.";
  if (mode !== undefined && mode !== "upsert" && mode !== "create") return 'manageCollection: `mode` must be "upsert" (default) or "create".';
  return { slug, items: items as CollectionItem[], mode: (mode as "upsert" | "create" | undefined) ?? "upsert" };
}

export function makeManageCollectionTool(deps: ManageCollectionDeps = {}) {
  return {
    definition: {
      name: "manageCollection",
      description:
        "Read and write records of a schema-driven collection through the host. getItems returns records WITH computed values (derived formulas, toggles, embeds) the stored JSON files don't contain; putItems validates each row against the collection's schema before writing and reports per-row rejects. Prefer it over raw file I/O on collection records.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["getItems", "putItems"], description: "What to do." },
          slug: { type: "string", description: "The collection's slug (its directory name, e.g. `stock-quotes`)." },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "getItems: only these record ids (primary-key values). Omit for all records.",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description: "getItems: only these fields per record (the primary key is always included). Omit for all fields. Use on large collections.",
          },
          items: {
            type: "array",
            items: { type: "object" },
            description: "putItems: the record objects to store. Each must carry the schema's primaryKey value (it doubles as the filename).",
          },
          mode: {
            type: "string",
            enum: ["upsert", "create"],
            description: 'putItems: "upsert" (default) overwrites existing records; "create" rejects rows whose id already exists.',
          },
        },
        required: ["action", "slug"],
      },
    },

    // Collections are workspace data every role can already reach via
    // raw Read/Write/Edit — gating the SAFER path per-role would only
    // push unlisted roles back onto unvalidated file I/O.
    alwaysActive: true,

    prompt:
      "Use `manageCollection` instead of raw Read/Write/Edit when working with a collection's records (raw file I/O stays available as the escape hatch). " +
      "`getItems` is the only way to see computed values — `derived` fields (e.g. a portfolio's value), `toggle` projections, and `embed` records are host-computed and never present in the stored JSON files. On large collections pass `ids` and/or `fields` to keep the result small. " +
      "`putItems` validates every row against the schema before writing (required fields, enum values, primaryKey = record id) and returns `{ written, rejected }`; fix each rejected row using its `problem` text and retry just those rows. Never include computed fields in a row you write.",

    async handler(args: Record<string, unknown>): Promise<string> {
      const action = typeof args.action === "string" ? args.action : "";
      const slug = typeof args.slug === "string" ? args.slug.trim() : "";
      if (!slug) return "manageCollection: `slug` is required (the collection's slug).";
      if (action !== "getItems" && action !== "putItems") return 'manageCollection: `action` must be "getItems" or "putItems".';
      const collection = await loadCollection(slug, deps);
      if (!collection) return `manageCollection: unknown collection '${defangForPrompt(slug)}' — its schema.json is missing or failed validation.`;
      if (action === "getItems") {
        const ids = optionalStringArray(args.ids, "ids");
        if (!ids.ok) return ids.error;
        const fields = optionalStringArray(args.fields, "fields");
        if (!fields.ok) return fields.error;
        return handleGetItems(collection, { slug, ids: ids.value, fields: fields.value }, deps);
      }
      const parsed = parsePutItems(args, slug);
      if (typeof parsed === "string") return parsed;
      return handlePutItems(collection, parsed, deps);
    },
  };
}

export const manageCollection = makeManageCollectionTool();
