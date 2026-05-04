// Shared mutable-state todo mock for E2E specs that exercise CRUD
// flows against the Todo explorer. Consolidates the scaffolding that
// `todo-columns.spec.ts` and `todo-items-crud.spec.ts` each had
// privately into a single fixture with optional per-resource
// dispatchers.
//
// Design:
//   - `items` and `columns` live in per-call closures so every test
//     run starts from a fresh clone of TODO_ITEMS / TODO_COLUMNS
//     (no cross-test leakage).
//   - `mockAllApis(page)` is NOT called here — the caller handles
//     that ordering so specs can register per-test overrides before
//     or after as needed. Playwright's reverse-order matching means
//     the order of mockAllApis vs this helper matters.
//   - Item + column dispatchers are handed in as callbacks. Specs
//     that only exercise columns skip the item dispatcher; specs
//     that only exercise items skip the column dispatcher. Missing
//     dispatchers return the current state unchanged for that verb.

import type { Page, Route } from "@playwright/test";
import { TODO_COLUMNS, TODO_ITEMS, type TodoFixture } from "./todos";
import { WORKSPACE_FILES } from "../../src/config/workspacePaths";
import { slugify as slugifyCanonical } from "../../server/utils/slug";

export interface StatusColumnFixture {
  id: string;
  label: string;
  isDone?: boolean;
}

export interface MutableTodoState {
  items: TodoFixture[];
  columns: StatusColumnFixture[];
}

interface DispatchResult {
  items?: TodoFixture[];
  columns?: StatusColumnFixture[];
  /** Optional extra fields merged into the response body. */
  extra?: Record<string, unknown>;
}

export type ItemDispatcher = (method: string, path: string, body: Record<string, unknown>, state: MutableTodoState) => DispatchResult | undefined;

export type ColumnDispatcher = (method: string, id: string | null, body: Record<string, unknown>, state: MutableTodoState) => DispatchResult | undefined;

export interface MutableTodoOptions {
  items?: TodoFixture[];
  columns?: StatusColumnFixture[];
  /** Called for every item-related plugin dispatch (kind starts with
   *  `item`). The old REST `(method, path, body)` shape is preserved
   *  so callers written against the pre-#1145 mock keep working. */
  dispatchItem?: ItemDispatcher;
  /** Called for every column-related plugin dispatch (kind starts
   *  with `column`). Same translation layer as `dispatchItem`. */
  dispatchColumn?: ColumnDispatcher;
}

const TODO_DISPATCH_PATH = "/api/plugins/runtime/%40mulmoclaude%2Ftodo-plugin/dispatch";

interface DispatchBody {
  kind?: string;
  id?: string;
  ids?: string[];
  [key: string]: unknown;
}

interface TranslatedRequest {
  scope: "item" | "column";
  method: string;
  /** Path tail for items, column id for columns. */
  pathOrId: string;
}

// Map a runtime dispatch `{ kind, ... }` body to the legacy
// `(method, pathOrId, body)` shape the per-spec dispatchers were
// written against. Returns null for kinds that have no mutating
// effect (`listAll`) or that don't have a legacy equivalent.
function translateKind(body: DispatchBody): TranslatedRequest | null {
  switch (body.kind) {
    case "itemCreate":
      return { scope: "item", method: "POST", pathOrId: "" };
    case "itemPatch":
      return { scope: "item", method: "PATCH", pathOrId: body.id ?? "" };
    case "itemMove":
      return { scope: "item", method: "POST", pathOrId: `${body.id ?? ""}/move` };
    case "itemDelete":
      return { scope: "item", method: "DELETE", pathOrId: body.id ?? "" };
    case "columnsAdd":
      return { scope: "column", method: "POST", pathOrId: "" };
    case "columnPatch":
      return { scope: "column", method: "PATCH", pathOrId: body.id ?? "" };
    case "columnDelete":
      return { scope: "column", method: "DELETE", pathOrId: body.id ?? "" };
    case "columnsOrder":
      return { scope: "column", method: "POST", pathOrId: "reorder" };
    default:
      return null;
  }
}

// Derive a column id from a human label using the canonical slug
// rule (`server/utils/slug.ts`). Pre-#732 this was an inline
// reimplementation that diverged on the separator (`_` vs `-`) — see
// the slug-rule unification PR #787 for why the duplicate is now a
// thin wrapper instead. Playwright specs run in Node so we can import
// the canonical helper directly.
export function mockSlugifyColumnId(label: string): string {
  return slugifyCanonical(label, "column");
}

/**
 * Register route handlers for the Todo explorer's REST API plus the
 * file-tree + file-content endpoints it needs to even mount. Caller
 * is responsible for having called `mockAllApis(page)` first.
 *
 * Returns the mutable state handle so individual tests can inspect
 * it after the fact (e.g. to assert a final columns.length).
 */
export async function setupMutableTodoMocks(page: Page, options: MutableTodoOptions = {}): Promise<MutableTodoState> {
  const state: MutableTodoState = {
    items: (options.items ?? TODO_ITEMS).map((i) => ({ ...i })),
    columns: (options.columns ?? TODO_COLUMNS).map((col) => ({ ...col })),
  };

  const buildResponse = (extra?: Record<string, unknown>) => ({
    data: { items: state.items, columns: state.columns },
    ...extra,
  });

  // Single runtime-dispatch endpoint replaces the pre-#1145 REST
  // routes. Body shape: `{ kind, ...args }`. We translate each kind
  // back to the legacy `(method, pathOrId, body)` shape so existing
  // per-spec dispatchers (`dispatchItem` / `dispatchColumn`) keep
  // working unchanged.
  await page.route(
    (url) => url.pathname === TODO_DISPATCH_PATH,
    (route: Route) => {
      const body = (route.request().postDataJSON() ?? {}) as DispatchBody;

      // listAll (and any unknown kind) is read-only — echo state.
      if (body.kind === "listAll" || body.kind === undefined) {
        return route.fulfill({ json: buildResponse() });
      }
      const translated = translateKind(body);
      if (!translated) return route.fulfill({ json: buildResponse() });

      const bodyRec = body as Record<string, unknown>;
      const outcome =
        translated.scope === "item"
          ? options.dispatchItem?.(translated.method, translated.pathOrId, bodyRec, state)
          : options.dispatchColumn?.(translated.method, translated.pathOrId || null, bodyRec, state);
      if (outcome?.items) state.items = outcome.items;
      if (outcome?.columns) state.columns = outcome.columns;
      return route.fulfill({ json: buildResponse(outcome?.extra) });
    },
  );

  // File-explorer wiring so the TodoExplorer view can actually mount
  // when navigated via deep-link to the encoded plugin scope path
  // (`data/plugins/%40mulmoclaude%2Ftodo-plugin/todos.json` after
  // #1145). Only /api/files/content and /api/files/tree are mocked —
  // /api/files/dir (lazy-expand) is not, because the todo specs
  // deep-link straight into the content view.
  await page.route(
    (url) => url.pathname === "/api/files/content" && url.searchParams.get("path") === WORKSPACE_FILES.todosItems,
    (route: Route) =>
      route.fulfill({
        json: {
          kind: "text",
          path: WORKSPACE_FILES.todosItems,
          content: JSON.stringify(state.items),
          size: 500,
          modifiedMs: Date.now(),
        },
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/files/tree",
    (route: Route) =>
      route.fulfill({
        json: {
          name: "",
          path: "",
          type: "dir",
          children: [
            {
              name: "data",
              path: "data",
              type: "dir",
              children: [
                {
                  name: "plugins",
                  path: "data/plugins",
                  type: "dir",
                  children: [
                    {
                      name: "@mulmoclaude/todo-plugin",
                      path: "data/plugins/%40mulmoclaude%2Ftodo-plugin",
                      type: "dir",
                      children: [
                        {
                          name: "todos.json",
                          path: WORKSPACE_FILES.todosItems,
                          type: "file",
                          size: 500,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
  );

  return state;
}
