import type { Track } from "../../core/track";
import { readJson, sleep } from "../../lib/http";
import { openBrowser } from "../../lib/open-browser";

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";
const SERVICE = "Spotify";
/**
 * Документация Spotify обещает, что loopback-адрес можно зарегистрировать без порта, но на практике
 * авторизация отвечает «redirect_uri: Not matching configuration». Поэтому порт фиксированный и редкий.
 */
const CALLBACK_PORT = 47813;
export const REDIRECT_URI_TO_REGISTER = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export type SpotifyTokens = { accessToken: string; refreshToken: string; expiresAt: number };

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

function toTokens(data: TokenResponse, previousRefresh?: string): SpotifyTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previousRefresh ?? "",
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Вход по Authorization Code + PKCE: открывает браузер и ждёт возврата на локальный адрес. */
export async function loginWithPkce(clientId: string, scopes: string[], onUrl: (url: string) => void) {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));

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
        if (error || url.searchParams.get("state") !== state) {
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
  const redirectUri = REDIRECT_URI_TO_REGISTER;
  const timeout = setTimeout(() => reject(new Error("Вход в Spotify не завершён за 5 минут.")), LOGIN_TIMEOUT_MS);
  const authUrl = `${ACCOUNTS}/authorize?${new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: scopes.join(" "),
    state,
  })}`;
  onUrl(authUrl);
  openBrowser(authUrl);

  try {
    const code = await codePromise;
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });
    return toTokens(await readJson<TokenResponse>(SERVICE, res));
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
  return toTokens(await readJson<TokenResponse>(SERVICE, res), tokens.refreshToken);
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

export class SpotifyClient {
  constructor(private readonly accessToken: string) {}

  private async call<T>(path: string): Promise<T> {
    for (;;) {
      const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${this.accessToken}` } });
      if (res.status === 429) {
        await sleep(Number(res.headers.get("retry-after") ?? "2") * 1000);
        continue;
      }
      return readJson<T>(SERVICE, res);
    }
  }

  async displayName(): Promise<string> {
    const me = await this.call<{ display_name?: string; id: string; product?: string }>("/me");
    return me.display_name ?? me.id;
  }

  /** Лайкнутые треки, от новых к старым. */
  async likedTracks(onProgress?: (loaded: number, total: number) => void): Promise<Track[]> {
    const result: Track[] = [];
    let path: string | null = "/me/tracks?limit=50";
    while (path) {
      const page: { items: { track: SpotifyTrack | null }[]; next: string | null; total: number } =
        await this.call(path);
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
}
