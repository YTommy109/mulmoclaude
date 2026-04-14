import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "presentDocument";

export interface MarkdownToolData {
  markdown: string;
  pdfPath?: string;
  filenameHint?: string;
}

/** True when the `markdown` field is a workspace-relative file path
 *  (stored under markdowns/*.md) rather than inline content. */
export function isFilePath(value: string): boolean {
  return value.startsWith("markdowns/") && value.endsWith(".md");
}

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Display a document in markdown format.",
  prompt:
    `Use the ${TOOL_NAME} tool to create structured documents with text and embedded images. This tool is ideal for:\n` +
    '- Guides, tutorials, and how-to content ("create a guide about...", "explain how to...")\n' +
    "- Educational content (lessons, explanations, timelines, concept visualizations)\n" +
    "- Reports and presentations (business reports, data analysis, infographics)\n" +
    "- Articles and blog posts with illustrations\n" +
    "- Documentation with diagrams or screenshots\n" +
    "- Recipes with step-by-step photos\n" +
    "- Travel guides with location images\n" +
    "- Product presentations or lookbooks\n" +
    "- Any content that combines written information with supporting visuals\n\n" +
    `IMPORTANT: Use this tool instead of just generating standalone images when the user wants informational or educational content with visuals. This creates a cohesive document with formatted text (markdown) AND images embedded at appropriate locations. For example, if asked to "create a guide about photosynthesis with a diagram", use ${TOOL_NAME} to create a full guide with explanatory text and the diagram embedded, rather than just generating the diagram image alone.\n\n` +
    "Format embedded images as: ![Detailed image prompt](__too_be_replaced_image_path__)",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Title for the document",
      },
      markdown: {
        type: "string",
        description:
          "The markdown content to display. Describe embedded images in the following format: ![Detailed image prompt](__too_be_replaced_image_path__). IMPORTANT: For embedded images, you MUST use the EXACT placeholder path '__too_be_replaced_image_path__'.",
      },
      filenameHint: {
        type: "string",
        description:
          "Short English filename for download (without extension). Use lowercase with hyphens, e.g. 'project-summary'. Required when the title is not in ASCII.",
      },
    },
    required: ["title", "markdown"],
  },
};

export default toolDefinition;
