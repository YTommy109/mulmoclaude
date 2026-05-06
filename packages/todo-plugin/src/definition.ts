// Tool schema for the todo plugin. Lives in its own module so both
// the server entry (`index.ts`) and any future browser entry can
// import it without dragging in handler code or its dependencies.
//
// `name: "manageTodoList" as const` is critical — it narrows the
// literal type so `definePlugin`'s `StrictPluginResult<N>` can
// require a matching named handler. It also matches the existing
// built-in plugin's TOOL_DEFINITION.name exactly so during the PR1
// → PR5 migration chain the runtime plugin and the static plugin
// collide on the same name. The runtime registry's collision policy
// (static wins) means this PR is no-op behaviour; PR5 deletes the
// static side, after which the runtime plugin takes over as the real
// `manageTodoList` handler.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageTodoList" as const,
  prompt: "When users mention tasks, things to do, or ask about their todo list, use manageTodoList to help them track items.",
  description:
    "Manage a todo list — show items, add, update, check/uncheck, or delete them. Items can optionally carry labels (tags) for categorisation; use labels to group related todos (e.g. 'Work', 'Groceries', 'Urgent') and filter the list at read time.",
  parameters: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["show", "add", "delete", "update", "check", "uncheck", "clear_completed", "add_label", "remove_label", "list_labels"],
        description: "Action to perform on the todo list.",
      },
      text: {
        type: "string",
        description: "For 'add': the todo item text. For 'delete', 'update', 'check', 'uncheck', 'add_label', 'remove_label': partial text to find the item.",
      },
      newText: {
        type: "string",
        description: "For 'update' only: the replacement text.",
      },
      note: {
        type: "string",
        description: "For 'add' or 'update': an optional note or extra detail for the item.",
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description:
          "For 'add': labels to tag the new item with. For 'add_label' / 'remove_label': labels to add to / remove from the item matched by 'text'. Labels are case-insensitive for matching but stored with their original case.",
      },
      filterLabels: {
        type: "array",
        items: { type: "string" },
        description: "For 'show' only: return only items that have at least one of these labels (OR semantics, case-insensitive). Omit to show all items.",
      },
    },
    required: ["action"],
  },
};
