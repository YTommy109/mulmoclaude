import type { ToolResult } from "gui-chat-protocol";
import type { ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME } from "./definition";
import type { ImageToolData } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";

function createUploadedImageResult(
  imageData: string,
  fileName: string,
  prompt: string,
): ToolResult<ImageToolData, never> {
  return {
    toolName: TOOL_NAME,
    data: { imageData, prompt },
    message: "",
    title: fileName,
  };
}

const generateImagePlugin: ToolPlugin<ImageToolData> = {
  toolDefinition,

  async execute(_context, args) {
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        return {
          toolName: TOOL_NAME,
          uuid: crypto.randomUUID(),
          error: (err as { message?: string }).message ?? res.statusText,
        };
      }
      const result = await res.json();
      return {
        ...result,
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
      };
    } catch (error) {
      return {
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  isEnabled: () => true,
  generatingMessage: "Generating image...",
  inputHandlers: [
    {
      type: "file",
      acceptedTypes: ["image/png", "image/jpeg"],
      handleInput: (fileData: string, fileName: string) =>
        createUploadedImageResult(fileData, fileName, ""),
    },
    {
      type: "clipboard-image",
      handleInput: (imageData: string) =>
        createUploadedImageResult(imageData, "clipboard-image.png", ""),
    },
  ],
  viewComponent: View,
  previewComponent: Preview,
};

export default generateImagePlugin;
export { TOOL_NAME };
