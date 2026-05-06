// Tool schema. Lives in its own module so both the server entry
// (`index.ts`) and the browser entry (`vue.ts`) can import it without
// dragging in the factory body, Zod, or any other server-only code.
//
// `manageDebug` is a tiny placeholder for now — the experimental
// debug page mostly drives plugin behaviour through pubsub + dispatch
// directly rather than through MCP tool calls. The single `echo`
// action exists so the tool surface is non-empty (the runtime loader
// rejects plugins without a tool definition).

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageDebug" as const,
  description:
    "Dev-only debug playground. Currently exposes a single `echo` action that round-trips a string back to the caller — used to verify the runtime plugin dispatch path is wired up. The richer interactions live on the standalone /debug page.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: ["echo"],
        description: "Operation to perform. Only `echo` is supported today.",
      },
      message: {
        type: "string",
        description: "String to echo back. Required for `echo`.",
      },
    },
    // `message` is required because the only supported `kind` (`echo`)
    // needs it. If a future action lands that doesn't, switch to a
    // conditional / oneOf schema rather than relaxing this list — the
    // Zod parser in index.ts is the source of truth and we want
    // schema-level rejection, not opaque ZodError surfacing through
    // dispatch.
    required: ["kind", "message"],
  },
};
