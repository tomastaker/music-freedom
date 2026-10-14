import { compare } from "../../core/match";
import type { MusicService } from "../../core/service";
import type { Track } from "../../core/track";
import { RateLimitError, readJson, sleep } from "../../lib/http";
import { openBrowser } from "../../lib/open-browser";

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";
const SERVICE = "Spotify";
/**
 * Документация Spotify обещает, что loopback-адрес можно зарегистрировать без порта, но на практике
 * авторизация отвечает «redirect_uri: Not matching configuration». Поэтому порт фиксированный и редкий.
 */
export const CALLBACK_PORT = 47813;
export const REDIRECT_URI_TO_REGISTER = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export type SpotifyTokens = { accessToken: string; refreshToken: string; expiresAt: number; scope?: string };

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

function toTokens(data: TokenResponse, previous?: SpotifyTokens): SpotifyTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous?.refreshToken ?? "",
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    scope: data.scope ?? previous?.scope,
  };
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export type PkceRequest = { authUrl: string; verifier: string; state: string };

/** Ссылка на вход по Authorization Code + PKCE. Spotify вернёт пользователя на REDIRECT_URI_TO_REGISTER. */
export async function createPkceRequest(clientId: string, scopes: string[]): Promise<PkceRequest> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const authUrl = `${ACCOUNTS}/authorize?${new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI_TO_REGISTER,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: scopes.join(" "),
    state,
  })}`;
  return { authUrl, verifier, state };
}

export async function exchangeCode(clientId: string, code: string, verifier: string): Promise<SpotifyTokens> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI_TO_REGISTER,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  return toTokens(await readJson<TokenResponse>(SERVICE, res));
}

/** Вход для консольной проверки: поднимает свой сервер на порту callback и ждёт возврата из браузера. */
export async function loginWithPkce(clientId: string, scopes: string[], onUrl: (url: string) => void) {
  const request = await createPkceRequest(clientId, scopes);
  const { promise: codePromise, resolve, reject } = Promise.withResolvers<string>();
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: CALLBACK_PORT,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") return new Response("Not found", { status: 404 });
        const error = url.searchParams.get("error");
        if (error || url.searchParams.get("state") !== request.state) {
          reject(new Error(`Spotify отклонил вход: ${error ?? "неверный state"}`));
          return new Response("Вход не выполнен. Вернитесь в окно программы.", { status: 400 });
        }
        resolve(url.searchParams.get("code") ?? "");
        return new Response("<meta charset=utf-8><p>Spotify подключён. Эту вкладку можно закрыть.</p>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });
  } catch (error) {
    throw new Error(`Порт ${CALLBACK_PORT} занят другой программой: закройте её и повторите вход. (${error})`);
  }
  const timeout = setTimeout(() => reject(new Error("Вход в Spotify не завершён за 5 минут.")), LOGIN_TIMEOUT_MS);
  onUrl(request.authUrl);
  openBrowser(request.authUrl);
  try {
    return await exchangeCode(clientId, await codePromise, request.verifier);
  } finally {
    clearTimeout(timeout);
    server.stop();
  }
}

export async function refreshTokens(clientId: string, tokens: SpotifyTokens): Promise<SpotifyTokens> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: clientId }),
  });
  return toTokens(await readJson<TokenResponse>(SERVICE, res), tokens);
}

type SpotifyTrack = {
  id: string;
  name: string;
  artists: { name: string }[];
  album?: { name: string };
  duration_ms: number;
  external_ids?: { isrc?: string };
};

function toTrack(t: SpotifyTrack): Track {
  return {
    service: "spotify",
    id: t.id,
    title: t.name,
    artists: t.artists.map((a) => a.name),
    album: t.album?.name,
    durationMs: t.duration_ms,
    isrc: t.external_ids?.isrc?.toUpperCase(),
  };
}

/** Пауза между запросами: лимит Spotify считается в скользящем окне 30 секунд. */
const MIN_INTERVAL_MS = 350;
/** Дольше этого ждать молча нельзя: пользователь должен узнать об ограничении. */
const MAX_SILENT_WAIT_S = 30;

export class SpotifyClient {
  private nextRequestAt = 0;

  constructor(private readonly getToken: () => Promise<string>) {}

  private async call<T>(path: string, method = "GET"): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.nextRequestAt - Date.now();
      this.nextRequestAt = Math.max(Date.now(), this.nextRequestAt) + MIN_INTERVAL_MS;
      if (wait > 0) await sleep(wait);
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await this.getToken()}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "2");
        if (retryAfter > MAX_SILENT_WAIT_S || attempt >= 5) {
          throw new RateLimitError(SERVICE, Date.now() + retryAfter * 1000);
        }
        await sleep(retryAfter * 1000);
        continue;
      }
      if (method !== "GET" && res.ok) return undefined as T;
      return readJson<T>(SERVICE, res);
    }
  }

  async displayName(): Promise<string> {
    const me = await this.call<{ display_name?: string; id: string }>("/me");
    return me.display_name ?? me.id;
  }

  likesPage(path: string) {
    return this.call<{ items: { track: SpotifyTrack | null }[]; next: string | null; total: number }>(path);
  }

  /** Лайкнутые треки, от новых к старым. */
  async likedTracks(onProgress?: (loaded: number, total: number) => void): Promise<Track[]> {
    const result: Track[] = [];
    let path: string | null = "/me/tracks?limit=50";
    while (path) {
      const page = await this.likesPage(path);
      for (const item of page.items) if (item.track) result.push(toTrack(item.track));
      onProgress?.(result.length, page.total);
      path = page.next ? page.next.replace(API, "") : null;
    }
    return result;
  }

  async searchTracks(query: string): Promise<Track[]> {
    const params = new URLSearchParams({ q: query, type: "track", limit: "10" });
    const data = await this.call<{ tracks: { items: SpotifyTrack[] } }>(`/search?${params}`);
    return data.tracks.items.map(toTrack);
  }

  /** Максимум 40 URI за запрос (PUT/DELETE /me/library). */
  async changeLibrary(method: "PUT" | "DELETE", trackIds: string[]): Promise<void> {
    const uris = trackIds.map((id) => `spotify:track:${id}`).join(",");
    await this.call(`/me/library?${new URLSearchParams({ uris })}`, method);
  }
}

export class SpotifyService implements MusicService {
  readonly id = "spotify" as const;

  constructor(readonly client: SpotifyClient) {}

  async overview(): Promise<{ account: string; likes: number }> {
    const [account, page] = await Promise.all([this.client.displayName(), this.client.likesPage("/me/tracks?limit=1")]);
    return { account, likes: page.total };
  }

  likedTracks(onProgress?: (loaded: number, total: number) => void): Promise<Track[]> {
    return this.client.likedTracks(onProgress);
  }

  async findCandidates(source: Track): Promise<Track[]> {
    const artist = source.artists[0] ?? "";
    const title = source.version ? `${source.title} ${source.version}` : source.title;
    // Запросы дорогие: у приложения разработчика маленькая квота, и после превышения Spotify
    // блокирует поиск почти на сутки. Следующий запрос делаем, только если предыдущий ничего не дал.
    if (source.isrc) {
      const byIsrc = await this.client.searchTracks(`isrc:${source.isrc}`);
      if (byIsrc.some((t) => compare(source, t) === "isrc")) return byIsrc;
    }
    const exact = await this.client.searchTracks(`track:${source.title} artist:${artist}`);
    if (exact.length > 0) return exact;
    return this.client.searchTracks(`${artist} ${title}`);
  }

  async addLikes(tracks: Track[], onProgress?: (done: number) => void): Promise<void> {
    // По одному: у пачки одна дата добавления, и порядок в Liked Songs потеряется.
    for (const [index, track] of tracks.entries()) {
      await this.client.changeLibrary("PUT", [track.id]);
      onProgress?.(index + 1);
      await sleep(120);
    }
  }

  async removeLikes(tracks: Track[]): Promise<void> {
    for (let i = 0; i < tracks.length; i += 40) {
      await this.client.changeLibrary(
        "DELETE",
        tracks.slice(i, i + 40).map((t) => t.id),
      );
    }
  }
}
