// Pure action handlers for the scheduler POST route. Each handler
// takes the current items + the relevant body fields and returns
// a discriminated result describing either an HTTP error or the
// next state. The route handler in scheduler.ts dispatches to one
// of these and translates the result into an HTTP response.
//
// Keeping the action logic pure (no I/O, no globals) makes it
// straightforward to unit-test every case in isolation, and brings
// the cognitive complexity of the route handler under the lint
// threshold.

import type { ScheduledItem } from "./scheduler.js";
import { makeId } from "../../utils/id.js";

export interface SchedulerActionInput {
  title?: string;
  id?: string;
  props?: Record<string, string | number | boolean | null>;
  items?: ScheduledItem[];
}

export type SchedulerActionResult =
  | { kind: "error"; status: number; error: string }
  | {
      kind: "success";
      items: ScheduledItem[];
      message: string;
      jsonData: Record<string, unknown>;
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

// Drops `endDate` when it would create an invalid range — either
// the start `date` itself isn't a clean ISO string, or `endDate`
// isn't ISO, or `endDate < date`. Single-day events (no `endDate`)
// pass through unchanged. Returns a new object only when something
// had to be removed.
//
// `req.body.props` is not runtime-validated upstream, so a payload
// of `{ props: 1 }` or `{ props: null }` reaches us — accept
// `unknown` and coerce non-object input to an empty props object
// instead of letting `"endDate" in props` throw a TypeError that
// the asyncHandler would surface as a 500.
export function sanitizeProps(props: unknown): ScheduledItem["props"] {
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    return {};
  }
  const record = props as ScheduledItem["props"];
  if (!("endDate" in record)) return record;
  const start = isoDate(record.date);
  const end = isoDate(record.endDate);
  if (start && end && end >= start) return record;
  const next = { ...record };
  Reflect.deleteProperty(next, "endDate");
  return next;
}

export function sortItems(items: ScheduledItem[]): ScheduledItem[] {
  return [...items].sort((left, right) => {
    const leftDate = typeof left.props.date === "string" ? left.props.date : null;
    const rightDate = typeof right.props.date === "string" ? right.props.date : null;
    const leftTime = typeof left.props.time === "string" ? left.props.time : "00:00";
    const rightTime = typeof right.props.time === "string" ? right.props.time : "00:00";
    const leftKey = leftDate ? `0_${leftDate}_${leftTime}` : `1_${left.createdAt}`;
    const rightKey = rightDate ? `0_${rightDate}_${rightTime}` : `1_${right.createdAt}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

export function handleShow(items: ScheduledItem[]): SchedulerActionResult {
  return {
    kind: "success",
    items,
    message: `Showing ${items.length} scheduled item(s)`,
    jsonData: {},
  };
}

export function handleAdd(items: ScheduledItem[], input: SchedulerActionInput): SchedulerActionResult {
  if (!input.title) {
    return { kind: "error", status: 400, error: "title required" };
  }
  const item: ScheduledItem = {
    id: makeId("sched"),
    title: input.title,
    createdAt: Date.now(),
    props: sanitizeProps(input.props ?? {}),
  };
  const next = sortItems([...items, item]);
  return {
    kind: "success",
    items: next,
    message: `Added: "${input.title}"`,
    jsonData: { added: item.id },
  };
}

export function handleDelete(items: ScheduledItem[], input: SchedulerActionInput): SchedulerActionResult {
  if (!input.id) {
    return { kind: "error", status: 400, error: "id required" };
  }
  const next = items.filter((i) => i.id !== input.id);
  const found = next.length < items.length;
  return {
    kind: "success",
    items: next,
    message: found ? `Deleted item ${input.id}` : `Item not found: ${input.id}`,
    jsonData: { deleted: input.id },
  };
}

function applyPropPatch(current: ScheduledItem["props"], patch: Record<string, string | number | boolean | null>): ScheduledItem["props"] {
  const next: ScheduledItem["props"] = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      Reflect.deleteProperty(next, key);
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function handleUpdate(items: ScheduledItem[], input: SchedulerActionInput): SchedulerActionResult {
  if (!input.id) {
    return { kind: "error", status: 400, error: "id required" };
  }
  const target = items.find((i) => i.id === input.id);
  if (!target) {
    return {
      kind: "success",
      items,
      message: `Item not found: ${input.id}`,
      jsonData: {},
    };
  }
  const mergedProps = input.props !== undefined ? applyPropPatch(target.props, input.props) : target.props;
  const updated: ScheduledItem = {
    ...target,
    title: input.title !== undefined ? input.title : target.title,
    props: sanitizeProps(mergedProps),
  };
  const next = sortItems(items.map((i) => (i.id === input.id ? updated : i)));
  return {
    kind: "success",
    items: next,
    message: `Updated: "${updated.title}"`,
    jsonData: { updated: input.id },
  };
}

export function handleReplace(_items: ScheduledItem[], input: SchedulerActionInput): SchedulerActionResult {
  if (!Array.isArray(input.items)) {
    return { kind: "error", status: 400, error: "items array required" };
  }
  const next = sortItems(input.items.map((item) => ({ ...item, props: sanitizeProps(item.props) })));
  return {
    kind: "success",
    items: next,
    message: `Replaced all items (${next.length} total)`,
    jsonData: { count: next.length },
  };
}

const HANDLERS: Record<string, (items: ScheduledItem[], input: SchedulerActionInput) => SchedulerActionResult> = {
  show: handleShow,
  add: handleAdd,
  delete: handleDelete,
  update: handleUpdate,
  replace: handleReplace,
};

export function dispatchScheduler(action: string, items: ScheduledItem[], input: SchedulerActionInput): SchedulerActionResult {
  const handler = HANDLERS[action];
  if (!handler) {
    return { kind: "error", status: 400, error: `Unknown action: ${action}` };
  }
  return handler(items, input);
}
