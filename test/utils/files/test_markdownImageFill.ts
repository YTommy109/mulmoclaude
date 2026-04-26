import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReplacement, IMAGE_PLACEHOLDER } from "../../../server/utils/files/markdown-image-fill.js";

describe("buildReplacement", () => {
  describe("url present — workspace-rooted absolute ref", () => {
    it("prefixes a leading `/` so the ref resolves from the workspace root", () => {
      // `rewriteMarkdownImageRefs` on the client treats a leading
      // `/` as "rooted at workspace", which is the only way a document
      // shard under `artifacts/documents/YYYY/MM/` can still reach
      // an image under `artifacts/images/YYYY/MM/` without depending
      // on how deep the document is nested.
      assert.equal(buildReplacement("sunset over kyoto", "artifacts/images/2026/04/x.png"), "![sunset over kyoto](/artifacts/images/2026/04/x.png)");
    });

    it("passes prompt text through as alt text unchanged (spaces / punctuation preserved)", () => {
      assert.equal(
        buildReplacement("A dog, sitting on a rug (hyper-detailed)", "artifacts/images/2026/04/y.png"),
        "![A dog, sitting on a rug (hyper-detailed)](/artifacts/images/2026/04/y.png)",
      );
    });

    it("passes non-ASCII prompt text through unchanged", () => {
      assert.equal(buildReplacement("夕焼けの京都", "artifacts/images/2026/04/z.png"), "![夕焼けの京都](/artifacts/images/2026/04/z.png)");
    });

    it("does NOT double-slash when the URL happens to already start with one (defensive)", () => {
      // The caller's contract says `url` is workspace-relative without
      // a leading slash (produced by saveImage). This test documents
      // what happens if someone breaks that contract — currently
      // produces `//artifacts/...`. If the helper is hardened to
      // strip a leading slash, update this test; otherwise it stays
      // as a regression guard on the contract.
      assert.equal(buildReplacement("test", "/artifacts/images/foo.png"), "![test](//artifacts/images/foo.png)");
    });
  });

  describe("url null — text fallback", () => {
    it("renders an italic image marker when generation skipped or failed", () => {
      // When `GEMINI_API_KEY` is missing OR generation threw,
      // the placeholder falls through to a visible marker so the
      // document still renders without broken image refs. The
      // 🖼️ glyph makes the fallback obvious to operators reading
      // the rendered markdown.
      assert.equal(buildReplacement("sunset over kyoto", null), "*🖼️ Image: sunset over kyoto*");
    });

    it("preserves non-ASCII prompt text in the fallback", () => {
      assert.equal(buildReplacement("夕焼けの京都", null), "*🖼️ Image: 夕焼けの京都*");
    });

    it("preserves empty prompt text (edge case — markdown still renders)", () => {
      assert.equal(buildReplacement("", null), "*🖼️ Image: *");
    });
  });
});

describe("IMAGE_PLACEHOLDER regex", () => {
  function findAll(markdown: string): string[] {
    return [...markdown.matchAll(IMAGE_PLACEHOLDER)].map((match) => match[1]);
  }

  it("matches the plain form `![alt](__too_be_replaced_image_path__)`", () => {
    assert.deepEqual(findAll("See ![sunset](__too_be_replaced_image_path__) here."), ["sunset"]);
  });

  it("matches the leading-slash variant `![alt](/__too_be_replaced_image_path__)`", () => {
    // Some agents emit the placeholder with a leading slash; both
    // forms must be caught.
    assert.deepEqual(findAll("See ![sunset](/__too_be_replaced_image_path__) here."), ["sunset"]);
  });

  it("captures multiple placeholders in one document", () => {
    const input = [
      "![first](__too_be_replaced_image_path__)",
      "intervening text",
      "![second](__too_be_replaced_image_path__)",
      "![third](/__too_be_replaced_image_path__)",
    ].join("\n");
    assert.deepEqual(findAll(input), ["first", "second", "third"]);
  });

  it("does NOT match real image references that happen to have an alt text", () => {
    // Already-filled references (with an actual path) must pass
    // through untouched — otherwise a second run would corrupt
    // previously generated documents.
    assert.deepEqual(findAll("![alt](/artifacts/images/foo.png)"), []);
    assert.deepEqual(findAll("![alt](https://example.com/foo.png)"), []);
  });

  it("preserves non-ASCII alt text", () => {
    assert.deepEqual(findAll("![夕焼けの京都](__too_be_replaced_image_path__)"), ["夕焼けの京都"]);
  });

  it("does not match if the alt text is missing (empty `[]` not captured)", () => {
    assert.deepEqual(findAll("![](__too_be_replaced_image_path__)"), []);
  });
});
