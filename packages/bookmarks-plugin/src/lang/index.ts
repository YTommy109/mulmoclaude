// Plugin-local i18n (#1110): translation tables travel with the
// plugin bundle, no merge into the host vue-i18n. The plugin reads
// the host's locale via `useRuntime()` and looks up its own table
// reactively.
//
// Future plugins that need vue-i18n features (plural forms, linked
// messages) can spin up their own `createI18n()` instance instead.

import { computed } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import en from "./en";
import ja from "./ja";

const MESSAGES = { en, ja } as const;
type LocaleKey = keyof typeof MESSAGES;

function isSupportedLocale(value: string): value is LocaleKey {
  return value in MESSAGES;
}

export function useT() {
  const { locale } = useRuntime();
  return computed(() => (isSupportedLocale(locale.value) ? MESSAGES[locale.value] : MESSAGES.en));
}
