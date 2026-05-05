// 日本語コピー。Plugin-local i18n は en/ja のみ — host の 8 言語
// 体制とは独立して plugin 自身で必要な分を抱える方針 (todo / bookmarks
// と同じ)。

export default {
  title: "Spotify",
  notConnected: "Spotify に未接続です",
  notConfigured: "Client ID が未設定です",
  configureHelp: "Spotify Developer Dashboard で発行した Client ID を貼り付けて Save を押してください。",
  configurePlaceholder: "Spotify Client ID",
  save: "保存",
  saving: "保存中…",
  saved: "保存しました。",
  saveFailed: "保存に失敗しました。",
  connect: "Spotify に接続",
  connecting: "Spotify の同意画面を開きます…",
  connected: "接続済み",
  disconnect: "切断",
  refresh: "更新",
  setupGuideLink: "Client ID の取得方法",
  scopes: "Scope",
  expiresAt: "有効期限",

  tabLiked: "Liked",
  tabPlaylists: "Playlists",
  tabRecent: "Recent",
  tabNowPlaying: "Now playing",

  empty: "表示する項目がありません。",
  emptyLiked: "Liked Songs がありません。",
  emptyPlaylists: "Playlist が見つかりませんでした。",
  emptyRecent: "最近聞いた曲はありません。",
  emptyNowPlaying: "現在再生中の曲はありません。",

  loading: "読み込み中…",
  loadFailed: "読み込みに失敗しました。",
  retry: "再試行",

  trackBy: "—",
  tracksCount: "曲",

  previewSummary: "Spotify",

  // Player Controls (PR 3)
  playerControls: "再生制御",
  premiumRequired: "再生制御には Spotify Premium が必要です。Free / Open アカウントでは利用できません。それ以外の機能はそのまま使えます。",
  volume: "音量",
  devices: "デバイス",
  deviceActive: "アクティブ",
  transferToDevice: "ここに移す",
} as const;
