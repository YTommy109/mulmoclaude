import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { readImgSrcInPresentHtml, sendChatMessage, startNewSession, waitForImgInPresentHtml } from "../fixtures/live-chat.ts";

const L01_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

test.describe("media (real LLM)", () => {
  test("L-01: presentHtml の <img src='/artifacts/...'> が /api/files/raw にリライトされる", async ({ page }) => {
    test.setTimeout(L01_TIMEOUT_MS);

    await startNewSession(page);

    // Ask the LLM to call presentHtml with an <img> whose src points
    // at a workspace path. The fixture file does not exist on disk,
    // which is fine — this scenario only verifies that the rewrite
    // path is wired up (B-18 regression check). A separate live
    // scenario covers the "image actually renders" case.
    const message = [
      "以下の HTML を presentHtml ツールでそのまま表示してください。",
      "画像ファイルが存在しなくても構いません(リライトの動作確認のみ)。",
      "",
      "<h1>e2e-live L-01 test</h1>",
      '<img src="/artifacts/images/sample.png" alt="sample" />',
    ].join("\n");
    await sendChatMessage(page, message);

    // Wait for the LLM to respond *and* presentHtml to render the
    // <img> inside the iframe. We wait on the inner <img> rather
    // than just the iframe element because the iframe is appended
    // to the DOM before its srcdoc finishes rendering.
    await waitForImgInPresentHtml(page, 'img[alt="sample"]');

    const src = await readImgSrcInPresentHtml(page, 'img[alt="sample"]');
    expect(src, "presentHtml iframe should contain <img alt='sample'>").not.toBeNull();
    expect(src!).toContain("/api/files/raw");
    expect(src!).toContain("sample.png");
    expect(src!, "raw /artifacts path must not survive the rewrite").not.toMatch(/^\/artifacts\//);
  });
});
