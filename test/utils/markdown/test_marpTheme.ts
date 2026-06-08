import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureThemeDirective, marpThemeNameFromFilename, sanitizeMarpThemeCss } from "../../../src/utils/markdown/marpTheme.ts";

describe("marpThemeNameFromFilename", () => {
  it("strips the .css extension", () => {
    assert.equal(marpThemeNameFromFilename("corporate.css"), "corporate");
  });

  it("accepts dashes and underscores", () => {
    assert.equal(marpThemeNameFromFilename("dark-mode_v2.css"), "dark-mode_v2");
  });

  it("rejects files that are not .css", () => {
    assert.equal(marpThemeNameFromFilename("corporate.txt"), null);
    assert.equal(marpThemeNameFromFilename("corporate"), null);
  });

  it("rejects names with characters outside [A-Za-z0-9_-]", () => {
    assert.equal(marpThemeNameFromFilename("ja 日本語.css"), null);
    assert.equal(marpThemeNameFromFilename("with.dot.css"), null);
    assert.equal(marpThemeNameFromFilename("with space.css"), null);
  });

  it("accepts a mixed-case extension", () => {
    assert.equal(marpThemeNameFromFilename("Corporate.CSS"), "Corporate");
  });
});

describe("ensureThemeDirective", () => {
  it("adds a directive when none exists", () => {
    const css = "section { background: navy; }";
    assert.equal(ensureThemeDirective(css, "corporate"), "/* @theme corporate */\nsection { background: navy; }");
  });

  it("replaces an existing directive with the canonical name", () => {
    const css = "/* @theme totally-different */\nsection { background: navy; }";
    assert.equal(ensureThemeDirective(css, "corporate"), "/* @theme corporate */\nsection { background: navy; }");
  });

  it("trims leading whitespace left by the replaced directive", () => {
    const css = "  /* @theme old */  \n\nsection { color: red; }";
    assert.equal(ensureThemeDirective(css, "fresh"), "/* @theme fresh */\nsection { color: red; }");
  });
});

describe("sanitizeMarpThemeCss", () => {
  it("accepts plain CSS", () => {
    assert.equal(sanitizeMarpThemeCss("section { background: navy; }").ok, true);
  });

  it("accepts data: URLs (inline fonts)", () => {
    const css = `@font-face { font-family: 'X'; src: url(data:font/woff2;base64,abc) format('woff2'); }`;
    assert.equal(sanitizeMarpThemeCss(css).ok, true);
  });

  it("rejects external @import url(http...)", () => {
    const css = `@import url("http://attacker.example/track.css");`;
    const result = sanitizeMarpThemeCss(css);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /@import/);
  });

  it("rejects external @import url(https...)", () => {
    assert.equal(sanitizeMarpThemeCss(`@import url(https://example.com/x.css);`).ok, false);
  });

  it("rejects bare-string @import 'http://...'", () => {
    assert.equal(sanitizeMarpThemeCss(`@import "http://example.com/x.css";`).ok, false);
  });

  it("rejects url(http://...) inside font-face src", () => {
    const css = `@font-face { font-family: 'X'; src: url(http://attacker.example/leak.woff2); }`;
    assert.equal(sanitizeMarpThemeCss(css).ok, false);
  });
});
