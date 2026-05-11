// Plugin-facing chat API. The host attaches a per-plugin instance of
// `ChatRuntimeApi` to the `PluginRuntime` it constructs for each
// plugin (`server/plugins/runtime.ts`).
//
// `start()` opens a normal chat seeded with a plugin-supplied first
// message. The seed is persisted as the first user turn; Claude
// responds to it as if the user had typed it. Pair the returned
// `chatId` with `runtime.notifier.publish({ navigateTarget:
// `/chat/${chatId}`, ... })` so the user can land on the chat from
// the bell. The chat is permanent — appears in the user's chat list
// like any other.
//
// Plugin authors access this surface via the `MulmoclaudeRuntime`
// cast. See `runtime-tasks-api.ts` for the same pattern.

export interface ChatStartInput {
  /** First user turn. Phrase as the user would — Claude reads it as a
   *  user instruction and responds. Visually marked as plugin-seeded
   *  in the chat history so the user can tell it came from a plugin,
   *  not from them. */
  initialMessage: string;
  /** Role to start the chat in. Defaults to `"general"`. */
  role?: string;
}

export interface ChatStartResult {
  /** New chat session id. Pair with notifier `navigateTarget` to send
   *  the user there. */
  chatId: string;
}

export interface ChatRuntimeApi {
  /** Open a new chat seeded with `initialMessage` as the first user
   *  turn. Returns the new chat session id. No cap on calls per
   *  plugin. Throws if the underlying `startChat` fails (invalid
   *  role, internal error). */
  start: (input: ChatStartInput) => Promise<ChatStartResult>;
}
