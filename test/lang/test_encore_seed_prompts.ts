// Guards the Encore plugin-seeded chat prompt i18n (#1545).
//
// The dashboard "+ Add" (startSetupChat) and per-obligation chat
// (startObligationChat) buttons compose their seed prompt from
// `encoreDashboard.seedPrompts` via vue-i18n and send it to the server
// only for non-English locales (for `en` the server keeps using its
// canonical constant). This test locks two invariants that vue-tsc
// alone doesn't cover:
//
//   - every locale carries both seed-prompt keys, and the obligation
//     template keeps the `{displayName}` / `{obligationId}`
//     placeholders verbatim — a dropped placeholder would surface a
//     raw `{obligationId}` to the user (and to the LLM as the first
//     turn)
//   - the English source (`en.ts`) stays byte-identical to the
//     server's canonical `SETUP_SEED_PROMPT` fallback, so the `en`
//     path can never silently diverge from the 7 translations
//
// No server side-effects: we only read the static message objects and
// the exported constant — `startChat` is never invoked.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import enMessages from "../../src/lang/en.js";
import jaMessages from "../../src/lang/ja.js";
import zhMessages from "../../src/lang/zh.js";
import koMessages from "../../src/lang/ko.js";
import esMessages from "../../src/lang/es.js";
import ptBRMessages from "../../src/lang/pt-BR.js";
import frMessages from "../../src/lang/fr.js";
import deMessages from "../../src/lang/de.js";
import { SETUP_SEED_PROMPT } from "../../server/encore/handlers/startSetupChat.js";

const LOCALES: [string, typeof enMessages][] = [
  ["en", enMessages],
  ["ja", jaMessages],
  ["zh", zhMessages],
  ["ko", koMessages],
  ["es", esMessages],
  ["pt-BR", ptBRMessages],
  ["fr", frMessages],
  ["de", deMessages],
];

describe("encore seed prompt i18n (#1545)", () => {
  for (const [name, messages] of LOCALES) {
    it(`${name}: seedPrompts.setup is a non-empty string`, () => {
      const { setup } = messages.encoreDashboard.seedPrompts;
      assert.equal(typeof setup, "string");
      assert.ok(setup.trim().length > 0, "setup seed prompt must not be empty");
    });

    it(`${name}: seedPrompts.obligation keeps both interpolation placeholders`, () => {
      const { obligation } = messages.encoreDashboard.seedPrompts;
      assert.ok(obligation.includes("{displayName}"), "must keep {displayName} placeholder");
      assert.ok(obligation.includes("{obligationId}"), "must keep {obligationId} placeholder");
    });
  }

  it("en setup seed matches the server's canonical fallback", () => {
    assert.equal(enMessages.encoreDashboard.seedPrompts.setup, SETUP_SEED_PROMPT);
  });
});
