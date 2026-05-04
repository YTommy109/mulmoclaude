import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentMulmoScript",
  apiRoutesKey: "mulmoScript",
  apiRoutes: {
    save: "/api/mulmo-script",
    updateBeat: "/api/mulmo-script/update-beat",
    updateScript: "/api/mulmo-script/update-script",
    beatImage: "/api/mulmo-script/beat-image",
    beatAudio: "/api/mulmo-script/beat-audio",
    generateBeatAudio: "/api/mulmo-script/generate-beat-audio",
    renderBeat: "/api/mulmo-script/render-beat",
    uploadBeatImage: "/api/mulmo-script/upload-beat-image",
    characterImage: "/api/mulmo-script/character-image",
    renderCharacter: "/api/mulmo-script/render-character",
    uploadCharacterImage: "/api/mulmo-script/upload-character-image",
    movieStatus: "/api/mulmo-script/movie-status",
    generateMovie: "/api/mulmo-script/generate-movie",
    downloadMovie: "/api/mulmo-script/download-movie",
  },
});
