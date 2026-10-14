// Демо-режим (MF_DEMO=1): выдуманные библиотеки в памяти, чтобы пройти весь сценарий,
// не трогая настоящие аккаунты. Данные синтетические.
import type { MusicService } from "../core/service";
import type { ServiceId, Track } from "../core/track";
import { sleep } from "../lib/http";

type Seed = [title: string, artist: string, seconds: number];

const SHARED: Seed[] = [
  ["Группа крови", "Кино", 286],
  ["Звезда по имени Солнце", "Кино", 225],
  ["Улица роз", "Ария", 352],
  ["Lose Yourself", "Eminem", 326],
  ["Numb", "Linkin Park", 187],
  ["Smells Like Teen Spirit", "Nirvana", 301],
  ["Чёрный бумер", "Серёга", 232],
  ["Spin Me Round", "Dead or Alive", 197],
  ["Halo", "Beyoncé", 261],
  ["Rolling in the Deep", "Adele", 228],
];
const ONLY_YANDEX: Seed[] = [
  ["Плот", "Юрий Лоза", 254],
  ["Кукла колдуна", "Король и Шут", 203],
  ["Восьмиклассница", "Кино", 213],
  ["Ветер", "Ария", 341],
  ["Танцевать", "Мураками", 210],
  ["Батарейка", "Жуки", 263],
  ["Everlong", "Foo Fighters", 250],
  ["Seven Nation Army", "The White Stripes", 232],
  ["Do I Wanna Know?", "Arctic Monkeys", 272],
  ["Mr. Brightside", "The Killers", 222],
  ["Песня о самом себе", "Местный исполнитель", 199],
  ["Back in Black", "AC/DC", 255],
];
const ONLY_SPOTIFY: Seed[] = [
  ["Blinding Lights", "The Weeknd", 200],
  ["Bad Guy", "Billie Eilish", 194],
  ["Levitating", "Dua Lipa", 203],
  ["Heat Waves", "Glass Animals", 238],
  ["Песня без каталога", "Малоизвестная группа", 181],
  ["Take on Me", "a-ha", 225],
];

const toTrack = (service: ServiceId, [title, artist, seconds]: Seed, index: number): Track => ({
  service,
  id: `${service}-${index}-${title}`,
  title,
  artists: [artist],
  durationMs: seconds * 1000,
});

class DemoService implements MusicService {
  constructor(
    readonly id: ServiceId,
    private readonly account: string,
    private likes: Track[],
    private readonly catalog: Track[],
  ) {}

  async overview() {
    await sleep(200);
    return { account: this.account, likes: this.likes.length };
  }

  async likedTracks(onProgress?: (loaded: number, total: number) => void) {
    for (let i = 0; i <= this.likes.length; i += 5) {
      onProgress?.(Math.min(i, this.likes.length), this.likes.length);
      await sleep(60);
    }
    return [...this.likes];
  }

  async findCandidates(source: Track) {
    await sleep(90);
    const word = source.title.toLowerCase().split(" ")[0] ?? "";
    return this.catalog.filter((t) => t.title.toLowerCase().includes(word));
  }

  async addLikes(tracks: Track[], onProgress?: (done: number) => void) {
    for (const [index, track] of tracks.entries()) {
      await sleep(150);
      this.likes = [track, ...this.likes];
      onProgress?.(index + 1);
    }
  }

  async removeLikes(tracks: Track[]) {
    const ids = new Set(tracks.map((t) => t.id));
    this.likes = this.likes.filter((t) => !ids.has(t.id));
  }
}

export function demoServices(): Record<ServiceId, MusicService> {
  const yandexLikes = [...SHARED, ...ONLY_YANDEX].map((s, i) => toTrack("yandex", s, i));
  const spotifyLikes = [...SHARED, ...ONLY_SPOTIFY].map((s, i) => toTrack("spotify", s, i));
  // Каталоги: почти всё находится; «Танцевать» нашлась только в концертной версии, а пара треков отсутствует.
  const spotifyCatalog = ONLY_YANDEX.filter(([title]) => title !== "Песня о самом себе").map((s, i) => {
    const track = toTrack("spotify", s, 100 + i);
    return s[0] === "Танцевать" ? { ...track, durationMs: track.durationMs + 9000 } : track;
  });
  const yandexCatalog = ONLY_SPOTIFY.filter(([title]) => title !== "Песня без каталога").map((s, i) =>
    toTrack("yandex", s, 100 + i),
  );
  return {
    yandex: new DemoService("yandex", "Демо-аккаунт Яндекса", yandexLikes, yandexCatalog),
    spotify: new DemoService("spotify", "Демо-аккаунт Spotify", spotifyLikes, spotifyCatalog),
  };
}
