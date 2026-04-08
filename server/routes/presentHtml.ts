import { Router, Request, Response } from "express";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { workspacePath } from "../workspace.js";
import { slugify } from "../utils/slug.js";

const router = Router();

interface PresentHtmlBody {
  html: string;
  title?: string;
}

interface PresentHtmlSuccessResponse {
  message: string;
  instructions: string;
  data: { html: string; title?: string; filePath: string };
}

interface PresentHtmlErrorResponse {
  error: string;
}

type PresentHtmlResponse =
  | PresentHtmlSuccessResponse
  | PresentHtmlErrorResponse;

router.post(
  "/present-html",
  async (
    req: Request<object, unknown, PresentHtmlBody>,
    res: Response<PresentHtmlResponse>,
  ) => {
    const { html, title } = req.body;
    if (!html) {
      res.status(400).json({ error: "html is required" });
      return;
    }

    try {
      const slug = title ? slugify(title) : "page";
      const fname = `${slug}-${Date.now()}.html`;
      const htmlDir = path.join(workspacePath, "HTMLs");
      await mkdir(htmlDir, { recursive: true });
      await writeFile(path.join(htmlDir, fname), html, "utf-8");

      const filePath = `HTMLs/${fname}`;
      res.json({
        message: `Saved HTML to ${filePath}`,
        instructions:
          "Acknowledge that the HTML page has been presented to the user.",
        data: { html, title, filePath },
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

export default router;
