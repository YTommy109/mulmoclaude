// English copy for the Spotify plugin View / Preview. Plugin-local
// i18n — same shape as bookmarks-plugin / todo-plugin.

export default {
  title: "Spotify",
  notConnected: "Not connected to Spotify",
  notConfigured: "Client ID not configured",
  configureHelp: "Paste your Spotify Developer Dashboard Client ID and click Save.",
  configurePlaceholder: "Spotify Client ID",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  saveFailed: "Save failed.",
  connect: "Connect Spotify",
  connecting: "Opening Spotify consent…",
  connected: "Connected.",
  reconnect: "Reconnect",
  disconnect: "Disconnect",
  refresh: "Refresh",
  setupGuideLink: "How do I get a Client ID?",
  scopes: "Scopes",
  expiresAt: "Expires",

  tabLiked: "Liked",
  tabPlaylists: "Playlists",
  tabRecent: "Recent",
  tabNowPlaying: "Now playing",

  empty: "Nothing to show.",
  emptyLiked: "You haven't liked any songs yet.",
  emptyPlaylists: "No playlists found.",
  emptyRecent: "No recently played tracks.",
  emptyNowPlaying: "Nothing is playing right now.",

  loading: "Loading…",
  loadFailed: "Failed to load.",
  retry: "Retry",

  trackBy: "by",
  tracksCount: "tracks",

  previewSummary: "Spotify",

  // Player Controls (PR 3)
  playerControls: "Playback",
  premiumRequired: "Spotify Premium is required to control playback. Free / open accounts cannot use these controls; the rest of the plugin still works.",
  volume: "Volume",
  devices: "Devices",
  deviceActive: "active",
  transferToDevice: "Transfer here",
  btnPrevious: "Previous track",
  btnPause: "Pause",
  btnPlay: "Play",
  btnNext: "Next track",
} as const;
