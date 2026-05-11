// Plugin-local i18n — bookmarks/todo と同じ pattern。

import { computed } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import en from "./en";
import ja from "./ja";

const MESSAGES = { en, ja } as const;
type LocaleKey = keyof typeof MESSAGES;

function isSupportedLocale(value: string): value is LocaleKey {
  // `in` walks the prototype chain so `"toString" in MESSAGES`
  // would return true. Use the own-property check to avoid
  // accidentally accepting inherited `Object.prototype` keys.
  return Object.prototype.hasOwnProperty.call(MESSAGES, value);
}

export function useT() {
  const { locale } = useRuntime();
  return computed(() => (isSupportedLocale(locale.value) ? MESSAGES[locale.value] : MESSAGES.en));
}
