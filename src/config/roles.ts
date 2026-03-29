export interface Role {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  availablePlugins: string[];
}

export const ROLES: Role[] = [
  {
    id: "general",
    name: "General",
    icon: "star",
    prompt: "You are a helpful assistant with access to the user's workspace. Help with tasks, answer questions, and use available tools when appropriate.",
    availablePlugins: [],
  },
  {
    id: "organizer",
    name: "Organizer",
    icon: "check_circle",
    prompt: "You are a personal productivity assistant. Help the user manage their todos, calendar, and contacts stored in the workspace. Use the todo, calendar, and contacts tools to display and update data visually.",
    availablePlugins: ["manageTodoList", "calendar", "contacts"],
  },
  {
    id: "developer",
    name: "Developer",
    icon: "code",
    prompt: "You are a coding assistant with full access to the workspace file system. Read, write, and modify code files. Use bash to run commands, tests, and scripts. Show file structure and diffs visually when helpful.",
    availablePlugins: ["fileTree", "diffViewer", "docReader"],
  },
  {
    id: "office",
    name: "Office",
    icon: "business_center",
    prompt: "You are a professional office assistant. Create and edit documents, spreadsheets, and presentations. Read existing files in the workspace for context.",
    availablePlugins: ["presentDocument", "spreadsheet", "showPresentation", "generateImage"],
  },
  {
    id: "brainstorm",
    name: "Brainstorm",
    icon: "lightbulb",
    prompt: "You are a creative brainstorming facilitator. Help visualize and explore ideas using mind maps, images, and documents. Read workspace files for context when relevant.",
    availablePlugins: ["createMindMap", "generateImage", "presentDocument"],
  },
];

export const DEFAULT_ROLE_ID = "general";

export function getRole(id: string): Role {
  return ROLES.find(r => r.id === id) ?? ROLES[0];
}
