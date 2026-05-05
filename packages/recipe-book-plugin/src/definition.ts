// Tool schema. Lives in its own module so both the server entry
// (`index.ts`) and the browser entry (`vue.ts`) can import it without
// dragging in the factory body, Zod, or any other server-only code.
//
// `name: "manageRecipes" as const` narrows the literal so
// `definePlugin`'s `PluginFactoryResult<N>` requires a handler exported
// under exactly this key.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageRecipes" as const,
  description:
    "List, save, update, or delete cooking recipes. Recipes live as one markdown file per recipe in the plugin's data dir, with structured YAML frontmatter (title, tags, servings, prep/cook times) plus a free-form markdown body for ingredients and steps.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: ["list", "save", "update", "delete"],
        description: "Operation to perform. Default: list.",
      },
      slug: {
        type: "string",
        description:
          "Recipe slug (filename). Required for save / update / delete. Lowercase ASCII letters, digits, and hyphens; 1-64 chars; no leading/trailing/consecutive hyphens.",
      },
      title: {
        type: "string",
        description: "Display title. May contain any unicode. Required for save and update.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Free-form tags (cuisine, course, …). Optional.",
      },
      servings: {
        type: "integer",
        description: "Number of servings (non-negative integer). Optional.",
      },
      prepTime: {
        type: "integer",
        description: "Prep time in minutes (non-negative integer). Optional.",
      },
      cookTime: {
        type: "integer",
        description: "Cook time in minutes (non-negative integer). Optional.",
      },
      body: {
        type: "string",
        description: "Markdown body of the recipe (ingredients + steps). Required for save and update.",
      },
    },
    required: ["kind"],
  },
};
