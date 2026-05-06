import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentMulmoScript",
  apiNamespace: "mulmoScript",
  apiRoutes: {
    /** POST /api/mulmoScript/save — create-new (`script`) or
     *  reopen-existing (`filePath`) MulmoScript. The MCP bridge
     *  posts here. */
    save: { method: "POST", path: "/save" },
    /** POST /api/mulmoScript/update-beat — overwrite one beat in
     *  an existing script. */
    updateBeat: { method: "POST", path: "/update-beat" },
    /** POST /api/mulmoScript/update-script — overwrite the
     *  whole script. */
    updateScript: { method: "POST", path: "/update-script" },
    /** GET /api/mulmoScript/beat-image — read a beat's pre-rendered
     *  image (data URI or null). */
    beatImage: { method: "GET", path: "/beat-image" },
    /** GET /api/mulmoScript/beat-audio — read a beat's pre-rendered
     *  audio. */
    beatAudio: { method: "GET", path: "/beat-audio" },
    /** POST /api/mulmoScript/generate-beat-audio — render audio
     *  for a beat (long-running). */
    generateBeatAudio: { method: "POST", path: "/generate-beat-audio" },
    /** POST /api/mulmoScript/render-beat — render the beat's
     *  image (long-running). */
    renderBeat: { method: "POST", path: "/render-beat" },
    /** POST /api/mulmoScript/upload-beat-image — replace a beat's
     *  image with one supplied by the user. */
    uploadBeatImage: { method: "POST", path: "/upload-beat-image" },
    /** GET /api/mulmoScript/character-image — read a character
     *  reference image. */
    characterImage: { method: "GET", path: "/character-image" },
    /** POST /api/mulmoScript/render-character — render a
     *  character reference image. */
    renderCharacter: { method: "POST", path: "/render-character" },
    /** POST /api/mulmoScript/upload-character-image — replace a
     *  character reference image with one supplied by the user. */
    uploadCharacterImage: { method: "POST", path: "/upload-character-image" },
    /** GET /api/mulmoScript/movie-status — poll for a generated
     *  movie's status / availability. */
    movieStatus: { method: "GET", path: "/movie-status" },
    /** POST /api/mulmoScript/generate-movie — kick off movie
     *  generation (returns SSE stream). */
    generateMovie: { method: "POST", path: "/generate-movie" },
    /** GET /api/mulmoScript/download-movie — download a generated
     *  movie file. */
    downloadMovie: { method: "GET", path: "/download-movie" },
  },
  mcpDispatch: "save",
});
