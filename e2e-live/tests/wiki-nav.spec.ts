import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { navigateToWikiPage, placeWikiPage, removeWikiPage } from "../fixtures/live-chat.ts";

const L14_TIMEOUT_MS = ONE_MINUTE_MS;
const L15_TIMEOUT_MS = ONE_MINUTE_MS;

// Each scenario seeds its own pair of wiki pages, so they do not
// share state. Run them in parallel to cut wall time.
test.describe.configure({ mode: "parallel" });

test.describe("wiki navigation (real workspace)", () => {
  test("L-14: wiki ページ内の内部リンクで /chat にリダイレクトされず対象ページが開く", async ({ page }, testInfo) => {
    test.setTimeout(L14_TIMEOUT_MS);
    // Covers B-23 / B-24 / B-25: the catch-all router used to swallow
    // /wiki/pages/<slug> links and bounce them back to /chat. We seed
    // two pages directly on disk (no LLM authoring drift) and click
    // the rendered <a> in the source page; the test fails if the URL
    // ever leaves the wiki surface.
    //
    // Slug uniqueness comes from two pieces:
    //   * Playwright project name — chromium / webkit do not race on
    //     the same disk file during parallel runs.
    //   * per-run nonce (timestamp + small random suffix) — even if a
    //     previous run was killed before its finally block fired, the
    //     stale fixture file lives under a different slug, so this
    //     run's cleanup only ever touches its own pages and never a
    //     user-owned page that happens to share a static name.
    const projectSlug = testInfo.project.name;
    // crypto.randomUUID over Math.random() — sonarjs/pseudo-random
    // flags the latter even though uniqueness is the only requirement
    // here (slugs aren't a security boundary). UUID is plenty unique
    // and keeps lint clean.
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const sourceSlug = `e2e-live-l14-source-${projectSlug}-${nonce}`;
    const targetSlug = `e2e-live-l14-target-${projectSlug}-${nonce}`;
    const targetMarker = "L-14 target body marker";
    // Both seed calls live inside the try block — if the second
    // placeWikiPage throws (filesystem error, permission, etc.) we
    // still hit finally and clean up the first page. removeWikiPage
    // is rm({ force: true }) under the hood, so calling it for a
    // slug that was never written is a no-op.
    //
    // mulmoclaude wiki uses double-bracket [[slug]] wikilinks (see
    // src/plugins/wiki/helpers.ts), not plain markdown links —
    // markdown links would be rewritten as Files-view paths and
    // produce a "File not found" view instead of routing to /wiki.
    try {
      await placeWikiPage(sourceSlug, [`# L-14 source`, ``, `[[${targetSlug}]]`, ``].join("\n"));
      await placeWikiPage(targetSlug, [`# L-14 target`, ``, targetMarker, ``].join("\n"));
      await navigateToWikiPage(page, sourceSlug);
      await page.locator(`.wiki-link[data-page="${targetSlug}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodeURIComponent(targetSlug)}$`));
      await expect(page.getByTestId("wiki-page-body")).toContainText(targetMarker);
      // Negative guard: if the catch-all regression resurfaces, the
      // SPA falls through to /chat (B-24's reported failure mode).
      await expect(page).not.toHaveURL(/\/chat/);
    } finally {
      await removeWikiPage(sourceSlug);
      await removeWikiPage(targetSlug);
    }
  });

  test("L-15: 非 ASCII slug の wiki ページが URL でも内部リンクでも開ける", async ({ page }, testInfo) => {
    test.setTimeout(L15_TIMEOUT_MS);
    // Covers B-26 / B-27: a wiki page whose slug starts with
    // Japanese characters has to survive the round trip through
    //   * isSafeWikiSlug (must accept non-ASCII)
    //   * URL percent-encoding / decoding on the SPA side
    //   * resolvePagePath's fuzzy `key.includes(slug)` branch on the
    //     server (wikiSlugify drops the Japanese chars to "" or to
    //     just the trailing ASCII suffix, so the exact-key map miss
    //     and the fuzzy fallback is what makes the file findable
    //     without depending on a seeded data/wiki/index.md row)
    //
    // Slug shape — the trailing ASCII tail must (1) survive
    // wikiSlugify so the fuzzy step has *something* to substring-
    // match against, and (2) NOT appear inside the sibling source
    // page's filename, otherwise the fuzzy `key.includes(slug)`
    // loop happily returns whichever matching key it iterates first
    // (readdir order). The first run of this spec hit exactly that:
    // both `日本語タイトル-${project}-${nonce}` and `e2e-live-l15-source-${project}-${nonce}`
    // collapse under wikiSlugify to a string ending in
    // `-${project}-${nonce}`, the source key contains that
    // substring too, and the target navigation rendered the source
    // page instead of the target. Using a target-unique
    // `nonascii-target-${nonce}` token keeps the fuzzy match
    // pointed at the right file. The shared `nonce` still drives
    // cleanup correlation across both pages.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const targetSlug = `日本語タイトル-nonascii-target-${projectSlug}-${nonce}`;
    const sourceSlug = `e2e-live-l15-source-${projectSlug}-${nonce}`;
    const targetMarker = "L-15 target body marker (本文サンプル)";
    // encodeURIComponent output is the percent-encoded path the
    // browser actually sits on; reuse it both for the URL assertion
    // regex and for documenting the encoded form. encodeURIComponent
    // is regex-safe (no `.` `(` `)` `*` etc. in its output for our
    // input), so we splice it into the RegExp source verbatim — same
    // shape L-14 uses one screen up.
    const encodedTargetSlug = encodeURIComponent(targetSlug);
    try {
      await placeWikiPage(sourceSlug, [`# L-15 source`, ``, `[[${targetSlug}]]`, ``].join("\n"));
      await placeWikiPage(targetSlug, [`# 日本語タイトル`, ``, targetMarker, ``].join("\n"));

      // (A) Direct URL routing — non-ASCII slug, no wikilink in the
      // path, just isSafeWikiSlug + resolvePagePath. If B-26 ever
      // regresses, the server returns "page not found" and the body
      // marker assertion fails fast.
      await navigateToWikiPage(page, targetSlug);
      await expect(page.getByTestId("wiki-page-body")).toContainText(targetMarker);
      await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodedTargetSlug}$`));
      // Negative guard mirroring L-14 — the catch-all router must
      // not swallow non-ASCII page slugs (B-24 regression shape).
      await expect(page).not.toHaveURL(/\/chat/);

      // (B) Wikilink click — `[[日本語…]]` renders verbatim into a
      // `.wiki-link[data-page="…"]` span (renderWikiLinks does no
      // slugification), so the click handler hands the raw slug to
      // the wiki router. Verifying this path keeps the [[ ]] →
      // router-push pipeline honest for non-ASCII targets.
      await navigateToWikiPage(page, sourceSlug);
      await page.locator(`.wiki-link[data-page="${targetSlug}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodedTargetSlug}$`));
      await expect(page.getByTestId("wiki-page-body")).toContainText(targetMarker);
      await expect(page).not.toHaveURL(/\/chat/);
    } finally {
      await removeWikiPage(sourceSlug);
      await removeWikiPage(targetSlug);
    }
  });
});
