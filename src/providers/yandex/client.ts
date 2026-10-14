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
export async function waitForDeviceToken(code: DeviceCode): Promise<string> {
  const deadline = Date.now() + code.expiresInSec * 1000;
  while (Date.now() < deadline) {
    await sleep(code.intervalSec * 1000);
    const res = await fetchIpv4(`${OAUTH}/token`, {
      method: "POST",
      headers: FORM,
      body: new URLSearchParams({
        grant_type: "device_code",
        code: code.deviceCode,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
    });
    const data = (await res.json()) as { access_token?: string; error?: string };
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
  };
}

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

  async accountUid(): Promise<number> {
    const status = await this.call<{ account: { uid?: number } }>("/account/status");
    if (!status.account.uid) throw new Error("Яндекс не вернул uid: токен недействителен.");
    return status.account.uid;
  }

  /** Идентификаторы лайкнутых треков, от новых к старым. */
  async likedTrackIds(uid: number): Promise<{ id: string; albumId?: string; timestamp: string }[]> {
    const data = await this.call<{
      library: { tracks: { id: string; albumId?: string; timestamp: string }[] };
    }>(`/users/${uid}/likes/tracks`);
    return data.library.tracks;
  }

  async tracks(ids: string[]): Promise<Track[]> {
    const result: Track[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = await this.call<YandexTrack[]>("/tracks", {
        "track-ids": ids.slice(i, i + 100).join(","),
        "with-positions": "false",
      });
      result.push(...batch.map(toTrack));
    }
    return result;
  }

  async searchTracks(query: string): Promise<Track[]> {
    const params = new URLSearchParams({ text: query, type: "track", page: "0" });
    const data = await this.call<{ tracks?: { results: YandexTrack[] } }>(`/search?${params}`);
    return (data.tracks?.results ?? []).map(toTrack);
  }
}
