import { Router, Request, Response } from "express";
import { getSessionImageData } from "../sessions.js";
import {
  generateGeminiImageContent,
  generateGeminiImageFromPrompt,
} from "../utils/gemini.js";
import { errorMessage } from "../utils/errors.js";

const router = Router();

interface GenerateImageBody {
  prompt: string;
  model?: string;
}

interface ImageSuccessResponse {
  message: string;
  instructions?: string;
  title?: string;
  data?: { imageData: string; prompt: string };
}

interface ImageErrorResponse {
  success: false;
  message: string;
}

type ImageResponse = ImageSuccessResponse | ImageErrorResponse;

router.post(
  "/generate-image",
  async (
    req: Request<object, unknown, GenerateImageBody>,
    res: Response<ImageResponse>,
  ) => {
    const { prompt, model } = req.body;

    if (!prompt) {
      res.status(400).json({ success: false, message: "prompt is required" });
      return;
    }

    try {
      const { imageData, message } = await generateGeminiImageFromPrompt(
        prompt,
        model,
      );
      if (imageData) {
        res.json({
          message: "image generation succeeded",
          instructions:
            "Acknowledge that the image was generated and has been presented to the user.",
          title: "Generated Image",
          data: {
            imageData: `data:image/png;base64,${imageData}`,
            prompt,
          },
        });
      } else {
        res.json({ message: message ?? "no image data in response" });
      }
    } catch (err) {
      res.status(500).json({ success: false, message: errorMessage(err) });
    }
  },
);

interface EditImageBody {
  prompt: string;
}

router.post(
  "/edit-image",
  async (
    req: Request<object, unknown, EditImageBody>,
    res: Response<ImageResponse>,
  ) => {
    const { prompt } = req.body;
    const session =
      typeof req.query.session === "string" ? req.query.session : undefined;

    if (!prompt) {
      res.status(400).json({ success: false, message: "prompt is required" });
      return;
    }

    const currentImageData = session ? getSessionImageData(session) : undefined;
    if (!currentImageData) {
      res.status(400).json({
        success: false,
        message:
          "No image is selected. Please click an image in the sidebar first, then ask me to edit it.",
      });
      return;
    }

    try {
      const base64Data = currentImageData.replace(
        /^data:image\/[^;]+;base64,/,
        "",
      );
      // /edit-image deliberately omits `config` (no aspectRatio) so
      // Gemini preserves the input image's dimensions.
      const { imageData, message } = await generateGeminiImageContent([
        {
          parts: [
            { inlineData: { mimeType: "image/png", data: base64Data } },
            { text: prompt },
          ],
        },
      ]);
      if (imageData) {
        res.json({
          message: "image edit succeeded",
          instructions:
            "Acknowledge that the image was edited and has been presented to the user.",
          title: "Edited Image",
          data: {
            imageData: `data:image/png;base64,${imageData}`,
            prompt,
          },
        });
      } else {
        res.json({ message: message ?? "no image data in response" });
      }
    } catch (err) {
      res.status(500).json({ success: false, message: errorMessage(err) });
    }
  },
);

export default router;
