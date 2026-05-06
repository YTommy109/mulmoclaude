// Tool schema. Lives in its own module so both the server entry
// (`index.ts`) and the browser entry (`vue.ts`) can import it without
// dragging in the factory body, Zod, or any other server-only code.

// `name: "manageBookmarks" as const` narrows the literal so
// `definePlugin`'s `PluginFactoryResult<N>` requires a handler exported
// under exactly this key. Without `as const` the name widens to
// `string` and the strict-handler check degrades to the loose runtime
// warn (see gui-chat-protocol/src/runtime.ts PluginFactoryResult).
export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageBookmarks" as const,
  description: "Save, list, or remove bookmarks (URL + title) in the user's workspace.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["add", "list", "remove", "setSort"] },
      url: { type: "string" },
      title: { type: "string" },
      id: { type: "string" },
      by: { type: "string", enum: ["addedAt", "title"] },
    },
    required: ["kind"],
  },
};
