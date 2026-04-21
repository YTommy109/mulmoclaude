// Japanese dictionary. Mirror the shape of src/lang/en.ts —
// missing keys fall back to English per createI18n's fallbackLocale.

const ja = {
  common: {
    save: "保存",
    cancel: "キャンセル",
  },
  sessionTabBar: {
    newSession: "新しいセッション",
    sessionHistory: "セッション履歴",
    // 日本語は単複同形のため左右同じ文字列だが、vue-i18n の
    // pluralization API に合わせて `|` 区切りで揃える。
    activeSessions: "{count} 件のアクティブセッション（エージェント実行中）",
    unreadReplies: "{count} 件の未読返信",
  },
  chatInput: {
    placeholder: "タスクを入力...",
    expandEditor: "エディタを広げる",
    composeMessage: "メッセージを作成",
    sendHint: "Cmd+Enter で送信",
    send: "送信",
    fileTooLarge: "ファイルが大きすぎます（{sizeMB} MB）。上限は 30 MB です。",
  },
};

export default ja;
