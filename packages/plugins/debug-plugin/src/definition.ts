// Tool schema. Lives in its own module so both the server entry
// (`index.ts`) and the browser entry (`vue.ts`) can import it without
// dragging in the factory body, Zod, or any other server-only code.
//
// Two LLM-callable actions:
//   - `echo` — round-trips a string back to the caller; used to
//     verify the runtime plugin dispatch path is wired up.
//   - `confirm-and-clear` — clears a pending notification stored
//     server-side by `chat-start-and-store` (Phase 1 of the Encore
//     plan demo). Plugin-seeded chats embed a `pendingId` in their
//     first user turn; the LLM passes that id back here when the
//     user confirms.
//
// Other actions exist on the dispatch path (publish, clear, tick-
// toggle, chat-start, chat-start-and-store) but are NOT in this
// schema — they're driven from the standalone /debug page UI, not
// via LLM tool calls. The Zod parser in `index.ts` is the source of
// truth for the full union; this schema is the LLM-visible subset.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageDebug" as const,
  description:
    "Dev-only debug playground. Two LLM-callable actions: `echo` round-trips a string (verifies dispatch), and `confirm-and-clear` clears a pending notification using a `pendingId` supplied in the chat's seed message (Encore plan demo). The richer interactions live on the standalone /debug page.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: ["echo", "confirm-and-clear"],
        description:
          "Operation to perform. Use 'echo' to round-trip `message`. Use 'confirm-and-clear' to clear the notification that opened this chat — pass `pendingId` exactly as supplied in the seed message.",
      },
      message: {
        type: "string",
        description: "String to echo back. Required when `kind` is 'echo'.",
      },
      pendingId: {
        type: "string",
        description: "Pending-clear ticket id from the seed message. Required when `kind` is 'confirm-and-clear'.",
      },
    },
    // Only `kind` is required at the JSON-schema layer — per-kind
    // requirements (`message` for echo, `pendingId` for confirm-and-
    // clear) are enforced by the discriminated-union Zod parser in
    // index.ts, which produces a clearer error than a conditional
    // `required` clause would.
    required: ["kind"],
  },
};
