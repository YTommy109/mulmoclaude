// Composable backing the kanban / file-explorer todo View. Wraps
// `runtime.dispatch` calls in a small ref-managed surface so the
// component code reads as `await todos.createItem({...})` rather than
// `await runtime.dispatch({kind: "itemCreate", ...})` everywhere.
//
// Live sync: subscribes to the plugin's "changed" pubsub channel and
// re-fetches on every server-side mutation, so a second tab editing
// the same workspace's todos updates this component's view too.

import { onMounted, onUnmounted, ref, type Ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { StatusColumn, TodoItem } from "../types";
import type { CreateInput, MoveInput, PatchInput } from "../handlers/items";
import { useT } from "../lang";

interface DispatchOk {
  data: { items?: TodoItem[]; columns?: StatusColumn[] };
  item?: TodoItem;
}

interface DispatchErr {
  error: string;
  status?: number;
}

type DispatchResponse = DispatchOk | DispatchErr;

function isErr(value: DispatchResponse): value is DispatchErr {
  return "error" in value;
}

export interface AddColumnInput {
  label?: string;
  isDone?: boolean;
}

export interface PatchColumnInput {
  label?: string;
  isDone?: boolean;
}

export interface UseTodosHandle {
  items: Ref<TodoItem[]>;
  columns: Ref<StatusColumn[]>;
  error: Ref<string | null>;
  refresh: () => Promise<boolean>;
  createItem: (input: CreateInput) => Promise<boolean>;
  patchItem: (id: string, input: PatchInput) => Promise<boolean>;
  moveItem: (id: string, input: MoveInput) => Promise<boolean>;
  deleteItem: (id: string) => Promise<boolean>;
  addColumn: (input: AddColumnInput) => Promise<boolean>;
  patchColumn: (id: string, input: PatchColumnInput) => Promise<boolean>;
  deleteColumn: (id: string) => Promise<boolean>;
  reorderColumns: (ids: string[]) => Promise<boolean>;
}

export function useTodos(initialItems: TodoItem[] = [], initialColumns: StatusColumn[] = []): UseTodosHandle {
  const t = useT();
  const { dispatch, pubsub } = useRuntime();
  const items = ref<TodoItem[]>(initialItems);
  const columns = ref<StatusColumn[]>(initialColumns);
  const error = ref<string | null>(null);

  function applyResult(payload: DispatchOk): void {
    if (Array.isArray(payload.data.items)) items.value = payload.data.items;
    if (Array.isArray(payload.data.columns) && payload.data.columns.length > 0) {
      columns.value = payload.data.columns;
    }
  }

  async function call<T extends object>(args: T): Promise<boolean> {
    error.value = null;
    try {
      const result = (await dispatch<DispatchResponse>(args)) as DispatchResponse;
      if (isErr(result)) {
        error.value = result.error;
        return false;
      }
      applyResult(result);
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  async function refresh(): Promise<boolean> {
    error.value = null;
    try {
      const result = (await dispatch<DispatchResponse>({ kind: "listAll" })) as DispatchResponse;
      if (isErr(result)) {
        error.value = t.value.loadFailed;
        return false;
      }
      applyResult(result);
      return true;
    } catch {
      error.value = t.value.loadFailed;
      return false;
    }
  }

  let unsub: (() => void) | undefined;
  onMounted(() => {
    unsub = pubsub.subscribe("changed", () => {
      void refresh();
    });
    void refresh();
  });
  onUnmounted(() => unsub?.());

  return {
    items,
    columns,
    error,
    refresh,
    createItem: (input) => call({ kind: "itemCreate", ...input }),
    patchItem: (id, input) => call({ kind: "itemPatch", id, ...input }),
    moveItem: (id, input) => call({ kind: "itemMove", id, ...input }),
    deleteItem: (id) => call({ kind: "itemDelete", id }),
    addColumn: (input) => call({ kind: "columnsAdd", ...input }),
    patchColumn: (id, input) => call({ kind: "columnPatch", id, ...input }),
    deleteColumn: (id) => call({ kind: "columnDelete", id }),
    reorderColumns: (ids) => call({ kind: "columnsOrder", ids }),
  };
}
