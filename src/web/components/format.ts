import type { Track } from "../../shared/api";

export const duration = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export const fullTitle = (track: Track) => (track.version ? `${track.title} (${track.version})` : track.title);

export const trackUrl = (track: Track) =>
  track.service === "spotify"
    ? `https://open.spotify.com/track/${track.id}`
    : `https://music.yandex.ru/track/${track.id}`;
