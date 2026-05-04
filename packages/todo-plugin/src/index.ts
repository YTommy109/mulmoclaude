// Todo plugin — server side. Migration from the built-in plugin
// (#1145) is fully done at this point; this is the active handler
// for `manageTodoList`.
//
// Two callers, two arg shapes:
//
//   1. **LLM (MCP) tool call** — args have an `action` field
//      ("show" | "add" | "delete" | "update" | "check" | ...).
//      Dispatched through `dispatchLlmAction` in handlers/llm.ts.
//      Response carries `message` + `jsonData` for the LLM and
//      `data.items` for the View.
//
//   2. **Frontend Vue View** — args have a `kind` field
//      ("listAll" | "itemCreate" | "itemPatch" | "itemMove" |
//       "itemDelete" | "columnsAdd" | "columnPatch" | "columnDelete"
//       | "columnsOrder"). Used by the kanban / file-explorer UI
//      via `runtime.dispatch({kind: ...})`. Response carries
//      `data.items` + `data.columns` + an optional `item`.
//
// Both paths share the same on-disk store (`todos.json` +
// `columns.json` under `runtime.files.data`). All mutating actions
// publish a `changed` pubsub event so multi-tab views auto-refresh.

import { definePlugin } from "gui-chat-protocol";
import { TOOL_DEFINITION } from "./definition";
import { loadTodos, saveTodos, loadColumns, saveColumns } from "./io";
import { dispatchTodos, type TodosActionInput } from "./handlers/llm";
import { handleAddColumn, handleDeleteColumn, handlePatchColumn, handleReorderColumns } from "./handlers/columns";
import { handleCreate, handleDeleteItem, handleMove, handlePatch, type CreateInput, type MoveInput, type PatchInput } from "./handlers/items";

export { TOOL_DEFINITION };
export type { TodoItem, TodoPriority, StatusColumn, TodoData } from "./types";

const READ_ONLY_ACTIONS = new Set(["show", "list_labels"]);

interface UiKindMap {
  listAll: Record<string, never>;
  itemCreate: CreateInput;
  itemPatch: { id: string } & PatchInput;
  itemMove: { id: string } & MoveInput;
  itemDelete: { id: string };
  columnsAdd: { label?: string; isDone?: boolean };
  columnPatch: { id: string; label?: string; isDone?: boolean };
  columnDelete: { id: string };
  columnsOrder: { ids: string[] };
}

type UiArgs = { [K in keyof UiKindMap]: { kind: K } & UiKindMap[K] }[keyof UiKindMap];

interface LlmArgs extends TodosActionInput {
  action: string;
}

function isLlmArgs(value: unknown): value is LlmArgs {
  return typeof value === "object" && value !== null && "action" in value && typeof (value as { action: unknown }).action === "string";
}

function isUiArgs(value: unknown): value is UiArgs {
  return typeof value === "object" && value !== null && "kind" in value && typeof (value as { kind: unknown }).kind === "string";
}

export default definePlugin(({ pubsub, files, log }) => {
  // ── LLM action path ───────────────────────────────────────────
  async function handleLlm(args: LlmArgs) {
    const { action, ...input } = args;
    log.info("dispatch llm", { action });
    const items = await loadTodos(files.data);
    const result = dispatchTodos(action, items, input);
    if (result.kind === "error") {
      log.warn("dispatch llm error", { action, error: result.error });
      return { error: result.error, status: result.status };
    }
    if (!READ_ONLY_ACTIONS.has(action)) {
      await saveTodos(files.data, result.items);
      pubsub.publish("changed", { reason: "llm-action", action });
    }
    return {
      data: { items: result.items },
      message: result.message,
      jsonData: result.jsonData,
      instructions: "Display the updated todo list to the user.",
    };
  }

  // ── UI dispatch path ──────────────────────────────────────────
  // eslint-disable-next-line sonarjs/cognitive-complexity -- the
  // switch covers 9 disjoint UI actions; further extraction would
  // just spread one big case statement across helper files for no
  // readability win.
  async function handleUi(args: UiArgs) {
    log.info("dispatch ui", { kind: args.kind });
    if (args.kind === "listAll") {
      const [items, columns] = await Promise.all([loadTodos(files.data), loadColumns(files.data)]);
      return { data: { items, columns } };
    }
    const [items, columns] = await Promise.all([loadTodos(files.data), loadColumns(files.data)]);
    if (args.kind === "itemCreate") {
      const result = handleCreate(items, columns, args);
      if (result.kind === "error") return { error: result.error, status: result.status };
      await saveTodos(files.data, result.items);
      pubsub.publish("changed", { reason: "item-create" });
      return { data: { items: result.items, columns }, ...(result.item && { item: result.item }) };
    }
    if (args.kind === "itemPatch") {
      const result = handlePatch(items, columns, args.id, args);
      if (result.kind === "error") return { error: result.error, status: result.status };
      await saveTodos(files.data, result.items);
      pubsub.publish("changed", { reason: "item-patch", id: args.id });
      return { data: { items: result.items, columns }, ...(result.item && { item: result.item }) };
    }
    if (args.kind === "itemMove") {
      const result = handleMove(items, columns, args.id, args);
      if (result.kind === "error") return { error: result.error, status: result.status };
      await saveTodos(files.data, result.items);
      pubsub.publish("changed", { reason: "item-move", id: args.id });
      return { data: { items: result.items, columns }, ...(result.item && { item: result.item }) };
    }
    if (args.kind === "itemDelete") {
      const result = handleDeleteItem(items, args.id);
      if (result.kind === "error") return { error: result.error, status: result.status };
      await saveTodos(files.data, result.items);
      pubsub.publish("changed", { reason: "item-delete", id: args.id });
      return { data: { items: result.items, columns } };
    }
    if (args.kind === "columnsAdd") {
      const result = handleAddColumn(columns, items, args);
      if (result.kind === "error") return { error: result.error, status: result.status };
      await saveColumns(files.data, result.columns);
      if (result.items) await saveTodos(files.data, result.items);
      pubsub.publish("changed", { reason: "column-add" });
      return { data: { items: result.items ?? items, columns: result.columns } };
    }
    if (args.kind === "columnPatch") {
      const result = handlePatchColumn(columns, args.id, args, items);
      if (result.kind === "error") return { error: result.error, status: result.status };
      await saveColumns(files.data, result.columns);
      if (result.items) await saveTodos(files.data, result.items);
      pubsub.publish("changed", { reason: "column-patch", id: args.id });
      return { data: { items: result.items ?? items, columns: result.columns } };
    }
    if (args.kind === "columnDelete") {
      const result = handleDeleteColumn(columns, args.id, items);
      if (result.kind === "error") return { error: result.error, status: result.status };
      await saveColumns(files.data, result.columns);
      if (result.items) await saveTodos(files.data, result.items);
      pubsub.publish("changed", { reason: "column-delete", id: args.id });
      return { data: { items: result.items ?? items, columns: result.columns } };
    }
    if (args.kind === "columnsOrder") {
      const result = handleReorderColumns(columns, args.ids);
      if (result.kind === "error") return { error: result.error, status: result.status };
      await saveColumns(files.data, result.columns);
      pubsub.publish("changed", { reason: "columns-order" });
      return { data: { items, columns: result.columns } };
    }
    const exhaustive: never = args;
    return { error: `unknown kind: ${JSON.stringify(exhaustive)}`, status: 400 };
  }

  return {
    TOOL_DEFINITION,
    async manageTodoList(rawArgs: unknown) {
      if (isLlmArgs(rawArgs)) return handleLlm(rawArgs);
      if (isUiArgs(rawArgs)) return handleUi(rawArgs);
      return { error: "unknown args shape — expected { action: ... } or { kind: ... }", status: 400 };
    },
  };
});
