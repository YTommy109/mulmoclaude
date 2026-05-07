// Tests for the height-reporter script splicer (#1219 follow-up).
// Mirrors the imageRepairInlineScript tests one-to-one — same splicing
// contract, same pure-string behavior, same edge cases.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HEIGHT_REPORTER_SCRIPT_TAG, injectHeightReporterScript } from "../../../src/utils/html/iframeHeightReporterScript.js";

describe("HEIGHT_REPORTER_SCRIPT_TAG — pure form", () => {
  it("uses the agreed message type", () => {
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /"mc-iframe-height"/);
  });

  it("posts to the parent window", () => {
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /parent\.postMessage/);
  });

  it("reports document.documentElement.scrollHeight", () => {
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /document\.documentElement\.scrollHeight/);
  });

  it("attaches both load and DOMContentLoaded listeners (so the first paint is sized)", () => {
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /addEventListener\("load"/);
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /addEventListener\("DOMContentLoaded"/);
  });

  it("guards ResizeObserver behind a feature check (older WebViews / iframe sandboxes may lack it)", () => {
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /window\.ResizeObserver/);
  });

  it("dispatches a synthetic window.resize on width changes (so Plotly etc. redraw)", () => {
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /dispatchEvent\(new Event\("resize"\)\)/);
  });

  it("calls Plotly.Plots.resize directly on width changes (Plotly's own observer sometimes misses iframe resizes)", () => {
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /Plotly/);
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /Plots\.resize/);
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /js-plotly-plot/);
  });

  it("guards every Plotly access behind a window.Plotly truthy check (no-op when chart library absent)", () => {
    // The pattern `window.Plotly;if(P&&P.Plots&&P.Plots.resize)` shows
    // both the truthy gate and method-existence gates.
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /window\.Plotly/);
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /P&&P\.Plots&&P\.Plots\.resize/);
  });

  it("only fires the resize dispatch when the width actually changed (no spam on height-only ticks)", () => {
    // Look for the gating pattern: the dispatch is conditional on a
    // width comparison. We guard by checking the conditional structure
    // is present rather than pinning the exact variable names.
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /contentRect/);
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /\.width/);
  });

  it("wraps in try/catch so a thrown postMessage doesn't break the iframe's own scripts", () => {
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /try\{/);
    assert.match(HEIGHT_REPORTER_SCRIPT_TAG, /catch\(e\)/);
  });
});

describe("injectHeightReporterScript", () => {
  const SCRIPT_OPEN = "<script>";
  const SCRIPT_CLOSE = "</script>";

  it("splices the script tag immediately before </body>", () => {
    const out = injectHeightReporterScript("<html><body><p>hi</p></body></html>");
    assert.match(out, /<\/p><script>[\s\S]+<\/script><\/body>/);
  });

  it("appends to the end when the document has no </body>", () => {
    const out = injectHeightReporterScript("<p>fragment with no body close</p>");
    assert.ok(out.startsWith("<p>fragment with no body close</p>"));
    assert.ok(out.endsWith(SCRIPT_CLOSE));
    assert.ok(out.includes(SCRIPT_OPEN));
  });

  it("is case-insensitive on </BODY>", () => {
    const out = injectHeightReporterScript("<HTML><BODY>x</BODY></HTML>");
    assert.match(out, /x<script>[\s\S]+<\/script><\/BODY>/);
  });

  it("tolerates whitespace inside the closing tag (`</body >`)", () => {
    const out = injectHeightReporterScript("<body>x</body >");
    assert.match(out, /x<script>[\s\S]+<\/script><\/body >/);
  });

  it("anchors at the LAST </body> when multiple closings appear (e.g. literal in code/CDATA)", () => {
    // Two `</body>` tokens — the first appears inside a `<pre>` block
    // as an example. The splicer must place the script before the
    // OUTER closing tag.
    const html = "<body>before<pre>literal: </body></pre>after</body>";
    const out = injectHeightReporterScript(html);
    // The injection point is just before the second (outer) </body>.
    assert.match(out, /after<script>[\s\S]+<\/script><\/body>$/);
  });

  it("returns the input unchanged when input is empty", () => {
    assert.equal(injectHeightReporterScript(""), "");
  });

  it("composes cleanly with injectImageRepairScript (both can be called in sequence)", async () => {
    const { injectImageRepairScript } = await import("../../../src/utils/image/imageRepairInlineScript.js");
    const raw = "<html><body><p>x</p></body></html>";
    const out = injectHeightReporterScript(injectImageRepairScript(raw));
    // Both scripts present in the output, both before </body>.
    const beforeClose = out.slice(0, out.lastIndexOf("</body>"));
    assert.ok(beforeClose.includes("mc-iframe-height"), "height reporter present");
    assert.ok(beforeClose.includes("error"), "image repair present");
  });

  it("processes 100K </body> tokens in linear time (regression guard against quadratic regex)", () => {
    // Smoke check: the function uses matchAll spread + index access,
    // which is linear. A quadratic implementation would explode here.
    const tokens = "</body>".repeat(100_000);
    const start = Date.now();
    const out = injectHeightReporterScript(tokens);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `linear-time invariant: 100K tokens in ${elapsed}ms`);
    // The script lands before the LAST </body>.
    const lastBody = out.lastIndexOf("</body>");
    assert.ok(out.slice(0, lastBody).includes("<script>"), "script before last </body>");
  });
});
