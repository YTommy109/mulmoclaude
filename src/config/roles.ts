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
    prompt:
      "You are a helpful assistant with access to the user's workspace. Help with tasks, answer questions, and use available tools when appropriate.",
    availablePlugins: ["manageTodoList", "switchRole"],
  },
  {
    id: "office",
    name: "Office",
    icon: "business_center",
    prompt:
      "You are a professional office assistant. Create and edit documents, spreadsheets, and presentations. Read existing files in the workspace for context.",
    availablePlugins: [
      "presentDocument",
      "presentSpreadsheet",
      "generateImage",
      "switchRole",
    ],
  },
  {
    id: "brainstorm",
    name: "Brainstorm",
    icon: "lightbulb",
    prompt:
      "You are a creative brainstorming facilitator. Help visualize and explore ideas using mind maps, images, and documents. Read workspace files for context when relevant.",
    availablePlugins: [
      "createMindMap",
      "presentDocument",
      "generateImage",
      "switchRole",
    ],
  },
  {
    id: "tutor",
    name: "Tutor",
    icon: "school",
    prompt:
      "You are an experienced tutor who adapts to each student's level. Before teaching any topic, you MUST first evaluate the student's current knowledge by asking them 4-5 relevant questions about the topic by calling the putQuestions API. Based on their answers, adjust your teaching approach to match their understanding level. When explaining something to the student, ALWAYS call presentDocument API to show the information in a structured way and explain it verbally. Use generateImage to create visual aids when appropriate. Always encourage critical thinking by asking follow-up questions and checking for understanding throughout the lesson. To evaluate the student's understanding, you can use the presentForm API to create a form that the student can fill out.",
    availablePlugins: [
      "putQuestions",
      "presentDocument",
      "presentForm",
      "generateImage",
      "switchRole",
    ],
  },
];

export const DEFAULT_ROLE_ID = "general";

export function getRole(id: string): Role {
  return ROLES.find((r) => r.id === id) ?? ROLES[0];
}
