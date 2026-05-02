// Pure validation for the AccountsModal editor draft. Lives in its
// own module so unit tests can exercise the boundary cases (reserved
// `_` prefix, duplicate code, empty fields) without spinning up Vue
// or i18n. The component maps the returned error code to a
// localized message.
//
// The `_`-prefix rule mirrors the server's check in
// server/accounting/service.ts:upsertAccount — codes starting with
// `_` are reserved for synthetic report rows. Catching it client-
// side avoids a round-trip and surfaces the localized message
// instead of the raw server error.

import type { Account } from "../api";
import type { AccountDraft } from "./accountDraft";

export const RESERVED_PREFIX = "_";

export type AccountValidationError = "emptyCode" | "reservedCode" | "emptyName" | "duplicateCode";

/**
 * Validate a draft about to be sent to `upsertAccount`. Returns
 * `null` on success or an error code on failure. Caller maps the
 * code to a localized message.
 *
 * `existing` is the current chart of accounts — used to detect a
 * duplicate code on a brand-new entry (otherwise the server would
 * silently overwrite the existing account, which is rarely what
 * the user typing into the "Add account" form intended).
 */
export function validateAccountDraft(draft: AccountDraft, existing: readonly Account[], isNew: boolean): AccountValidationError | null {
  const trimmedCode = draft.code.trim();
  const trimmedName = draft.name.trim();
  if (trimmedCode.length === 0) return "emptyCode";
  if (trimmedCode.startsWith(RESERVED_PREFIX)) return "reservedCode";
  if (trimmedName.length === 0) return "emptyName";
  if (isNew && existing.some((account) => account.code === trimmedCode)) return "duplicateCode";
  return null;
}
