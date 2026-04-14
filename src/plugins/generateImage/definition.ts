import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "generateImage";

export interface ImageToolData {
  imageData: string;
  prompt?: string;
}

export interface GenerateImageArgs {
  prompt: string;
}

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description:
    "Generate an image based on the prompt and display it on the screen. Be descriptive and specify the concrete details of the images in the prompt. Each call generates one image.",
  prompt: `When you are talking about places, objects, people, movies, books and other things, you MUST use the ${TOOL_NAME} API to draw pictures to make the conversation more engaging.`,
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "A detailed prompt describing the image to generate",
      },
    },
    required: ["prompt"],
  },
};

export default toolDefinition;
