import type { MusicService } from "../../core/service";
import type { Track } from "../../core/track";
import { fetchIpv4, HttpError, readJson, sleep } from "../../lib/http";

// Неофициальный API. Идентификатор и секрет принадлежат приложению Яндекс Музыки
// и публично используются всеми клиентскими библиотеками (см. MarshalX/yandex-music-api).
const CLIENT_ID = "23cabbbdc6cd418abb4b39c32c41195d";
const CLIENT_SECRET = "53bc75238f0c4d08a118e51fe9203300";
const OAUTH = "https://oauth.yandex.ru";
const API = "https://api.music.yandex.net";
const SERVICE = "Яндекс Музыка";
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  intervalSec: number;
  expiresInSec: number;
};

export async function requestDeviceCode(): Promise<DeviceCode> {
  const res = await fetchIpv4(`${OAUTH}/device/code`, {
    method: "POST",
    headers: FORM,
    body: new URLSearchParams({ client_id: CLIENT_ID }).toString(),
  });
  const data = await readJson<{
    device_code: string;
    user_code: string;
    verification_url: string;
    interval: number;
    expires_in: number;
  }>(SERVICE, res);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url,
    intervalSec: data.interval,
    expiresInSec: data.expires_in,
  };
}

/** Ждёт, пока пользователь введёт код на сайте Яндекса, и возвращает access token. */
export async function waitForDeviceToken(code: DeviceCode, signal?: AbortSignal): Promise<string> {
  const deadline = Date.now() + code.expiresInSec * 1000;
  while (Date.now() < deadline) {
    await sleep(code.intervalSec * 1000);
    signal?.throwIfAborted();
    let res: Response;
    let data: { access_token?: string; error?: string };
    try {
      res = await fetchIpv4(`${OAUTH}/token`, {
        method: "POST",
        headers: FORM,
        body: new URLSearchParams({
          grant_type: "device_code",
          code: code.deviceCode,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }).toString(),
      });
      data = (await res.json()) as typeof data;
    } catch {
      // Разовый сбой сети не отменяет вход: код ещё действует, спросим снова.
      continue;
    }
    if (data.access_token) return data.access_token;
    if (data.error !== "authorization_pending" && data.error !== "slow_down") {
      throw new HttpError(SERVICE, res.status, data.error ?? "unknown");
    }
  }
  throw new Error("Код подтверждения Яндекса истёк. Запустите вход заново.");
}

type YandexTrack = {
  id: string | number;
  title: string;
  version?: string;
  artists?: { name: string }[];
  albums?: { id: number; title?: string }[];
  durationMs?: number;
  isrc?: string;
};

function toTrack(t: YandexTrack): Track {
  return {
    service: "yandex",
    id: String(t.id),
    title: t.title,
    version: t.version || undefined,
    artists: (t.artists ?? []).map((a) => a.name),
    album: t.albums?.[0]?.title,
    durationMs: t.durationMs ?? 0,
    isrc: t.isrc || undefined,
    albumId: t.albums?.[0]?.id === undefined ? undefined : String(t.albums[0].id),
  };
}

const likeId = (t: Track) => (t.albumId ? `${t.id}:${t.albumId}` : t.id);

export class YandexClient {
  constructor(private readonly token: string) {}

  private async call<T>(path: string, form?: Record<string, string>): Promise<T> {
    const res = await fetchIpv4(`${API}${path}`, {
      method: form ? "POST" : "GET",
      headers: {
        Authorization: `OAuth ${this.token}`,
        "X-Yandex-Music-Client": "YandexMusicAndroid/24023621",
        "Accept-Language": "ru",
        ...(form ? FORM : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    return (await readJson<{ result: T }>(SERVICE, res)).result;
  }

  async account(): Promise<{ uid: number; name: string }> {
    const status = await this.call<{ account: { uid?: number; displayName?: string; login?: string } }>(
      "/account/status",
    );
    if (!status.account.uid) throw new Error("Яндекс не вернул uid: токен недействителен.");
    return { uid: status.account.uid, name: status.account.displayName ?? status.account.login ?? "" };
  }

  async accountUid(): Promise<number> {
    return (await this.account()).uid;
  }

  /** Идентификаторы лайкнутых треков, от новых к старым. */
  async likedTrackIds(uid: number): Promise<{ id: string; albumId?: string; timestamp: string }[]> {
    const data = await this.call<{
      library: { tracks: { id: string; albumId?: string; timestamp: string }[] };
    }>(`/users/${uid}/likes/tracks`);
    return data.library.tracks;
  }

  async tracks(ids: string[], onProgress?: (loaded: number) => void): Promise<Track[]> {
    const result: Track[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = await this.call<YandexTrack[]>("/tracks", {
        "track-ids": ids.slice(i, i + 100).join(","),
        "with-positions": "false",
      });
      result.push(...batch.map(toTrack));
      onProgress?.(result.length);
    }
    return result;
  }

  async changeLikes(uid: number, action: "add-multiple" | "remove", trackIds: string[]): Promise<void> {
    await this.call(`/users/${uid}/likes/tracks/${action}`, { "track-ids": trackIds.join(",") });
  }

  async searchTracks(query: string): Promise<Track[]> {
    const params = new URLSearchParams({ text: query, type: "track", page: "0" });
    const data = await this.call<{ tracks?: { results: YandexTrack[] } }>(`/search?${params}`);
    return (data.tracks?.results ?? []).map(toTrack);
  }
}

export class YandexService implements MusicService {
  readonly id = "yandex" as const;

  constructor(
    private readonly client: YandexClient,
    private readonly uid: number,
    private readonly accountName: string,
  ) {}

  static async connect(token: string): Promise<YandexService> {
    const client = new YandexClient(token);
    const { uid, name } = await client.account();
    return new YandexService(client, uid, name);
  }

  async overview(): Promise<{ account: string; likes: number }> {
    return { account: this.accountName, likes: (await this.client.likedTrackIds(this.uid)).length };
  }

  async likedTracks(onProgress?: (loaded: number, total: number) => void): Promise<Track[]> {
    const likes = await this.client.likedTrackIds(this.uid);
    onProgress?.(0, likes.length);
    const tracks = await this.client.tracks(
      likes.map((t) => (t.albumId ? `${t.id}:${t.albumId}` : t.id)),
      (loaded) => onProgress?.(loaded, likes.length),
    );
    // Лайк привязан к конкретному изданию: сохраняем альбом из списка лайков, чтобы снять ровно его.
    const albumById = new Map(likes.map((t) => [String(t.id), t.albumId]));
    return tracks.map((t) => ({ ...t, albumId: albumById.get(t.id) ?? t.albumId }));
  }

  async findCandidates(source: Track): Promise<Track[]> {
    const artist = source.artists[0] ?? "";
    return this.client.searchTracks(`${artist} ${source.title}`);
  }

  async addLikes(tracks: Track[], onProgress?: (done: number) => void): Promise<void> {
    // Пачками: так в разы меньше запросов. Порядок пачек сохраняется, внутри пачки у треков одна дата.
    for (let i = 0; i < tracks.length; i += 50) {
      const batch = tracks.slice(i, i + 50);
      await this.client.changeLikes(this.uid, "add-multiple", batch.map(likeId));
      onProgress?.(i + batch.length);
      await sleep(300);
    }
  }

  async removeLikes(tracks: Track[]): Promise<void> {
    for (let i = 0; i < tracks.length; i += 100) {
      await this.client.changeLikes(this.uid, "remove", tracks.slice(i, i + 100).map(likeId));
    }
  }
}
