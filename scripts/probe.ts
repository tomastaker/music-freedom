// Проверка на живых аккаунтах: только чтение, в библиотеках ничего не меняется.
// Отвечает на вопросы этапа 0: работает ли Яндекс через VPN, у скольких треков есть ISRC,
// насколько точно треки находятся в другом сервисе.
import { join } from "node:path";
import { bestMatch, LibraryIndex, type Match } from "../src/core/match";
import type { Track } from "../src/core/track";
import { HttpError, sleep } from "../src/lib/http";
import { appDataDir, loadTokens, saveTokens } from "../src/lib/token-store";
import { loginWithPkce, REDIRECT_URI_TO_REGISTER, refreshTokens, SpotifyClient } from "../src/providers/spotify/client";
import { requestDeviceCode, waitForDeviceToken, YandexClient } from "../src/providers/yandex/client";

const SAMPLE_SIZE = 20;
const report: string[] = [];

function log(line = "") {
  console.log(line);
  report.push(line);
}

function describeError(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 451) return `${error.service}: HTTP 451, сервис недоступен из текущей страны (VPN?)`;
    return `${error.service}: HTTP ${error.status} ${error.body.slice(0, 200)}`;
  }
  const code = (error as { code?: string }).code;
  if (code === "ECONNRESET" || code === "ConnectionRefused" || code === "ETIMEDOUT" || code === "ConnectionClosed") {
    return `сетевое соединение оборвано (${code}): сервис недоступен через текущую сеть или VPN`;
  }
  return error instanceof Error ? `${error.name}: ${error.message}${code ? ` [${code}]` : ""}` : String(error);
}

const label = (t: Track) => `${t.artists.join(", ")} - ${t.title}${t.version ? ` (${t.version})` : ""}`;
const percent = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : "-");

async function connectYandex(): Promise<{ client: YandexClient; likes: Track[] } | null> {
  log("\n=== Яндекс Музыка ===");
  const tokens = await loadTokens();
  try {
    let token = tokens.yandex?.accessToken;
    if (!token) {
      const code = await requestDeviceCode();
      console.log(`\nОткройте ${code.verificationUrl} и введите код: ${code.userCode}`);
      console.log("Жду подтверждения...");
      token = await waitForDeviceToken(code);
      await saveTokens({ ...(await loadTokens()), yandex: { accessToken: token } });
      log("Вход выполнен по коду подтверждения.");
    }
    const client = new YandexClient(token);
    const uid = await client.accountUid();
    const ids = await client.likedTrackIds(uid);
    log(`Лайков: ${ids.length}`);
    const likes = await client.tracks(ids.map((t) => (t.albumId ? `${t.id}:${t.albumId}` : t.id)));
    const withIsrc = likes.filter((t) => t.isrc).length;
    log(`Загружено треков: ${likes.length}, с ISRC: ${withIsrc} (${percent(withIsrc, likes.length)})`);
    return { client, likes };
  } catch (error) {
    log(`ОШИБКА: ${describeError(error)}`);
    return null;
  }
}

async function connectSpotify(): Promise<{ client: SpotifyClient; likes: Track[] } | null> {
  log("\n=== Spotify ===");
  const tokens = await loadTokens();
  try {
    let saved = tokens.spotify;
    if (!saved) {
      console.log(
        [
          "",
          "Нужен Client ID вашего приложения Spotify:",
          "1. Откройте https://developer.spotify.com/dashboard и нажмите Create app.",
          `2. В поле Redirect URIs добавьте ровно: ${REDIRECT_URI_TO_REGISTER} (именно http, не https, и с портом)`,
          "3. В разделе APIs used отметьте Web API и нажмите Save.",
          "4. Скопируйте Client ID со страницы приложения.",
        ].join("\n"),
      );
      const clientId = prompt("Client ID:")?.trim();
      if (!clientId) throw new Error("Client ID не введён");
      const fresh = await loginWithPkce(clientId, ["user-library-read"], (url) =>
        console.log(`\nОткрываю браузер. Если не открылся, перейдите по ссылке:\n${url}\n`),
      );
      saved = { clientId, ...fresh };
      await saveTokens({ ...(await loadTokens()), spotify: saved });
      log("Вход выполнен через браузер.");
    } else if (saved.expiresAt < Date.now()) {
      saved = { clientId: saved.clientId, ...(await refreshTokens(saved.clientId, saved)) };
      await saveTokens({ ...(await loadTokens()), spotify: saved });
    }
    const token = saved.accessToken;
    const client = new SpotifyClient(async () => token);
    log(`Аккаунт: ${await client.displayName()}`);
    const likes = await client.likedTracks((loaded, total) =>
      process.stdout.write(`\rЗагружаю лайки: ${loaded}/${total}`),
    );
    process.stdout.write("\n");
    const withIsrc = likes.filter((t) => t.isrc).length;
    log(`Лайков: ${likes.length}, с ISRC: ${withIsrc} (${percent(withIsrc, likes.length)})`);
    return { client, likes };
  } catch (error) {
    log(`ОШИБКА: ${describeError(error)}`);
    return null;
  }
}

/** Сколько лайков источника уже есть в лайках цели: проверка пропуска дублей без запросов к API. */
function overlap(from: Track[], to: Track[]): number {
  const index = new LibraryIndex(to);
  return from.filter((t) => index.find(t)).length;
}

async function sampleSearch(
  title: string,
  sources: Track[],
  targetLikes: Track[],
  search: (t: Track) => Promise<Track[]>,
) {
  log(`\n--- ${title}: последние ${SAMPLE_SIZE} лайков, которых ещё нет в цели ---`);
  const index = new LibraryIndex(targetLikes);
  const missing = sources.filter((t) => !index.find(t)).slice(0, SAMPLE_SIZE);
  const counts = { isrc: 0, high: 0, medium: 0, none: 0, error: 0 };
  for (const source of missing) {
    try {
      const match: Match | null = bestMatch(source, await search(source));
      counts[match?.level ?? "none"]++;
      log(`[${match?.level ?? "не найден"}] ${label(source)}${match ? `  =>  ${label(match.candidate)}` : ""}`);
    } catch (error) {
      counts.error++;
      log(`[ошибка] ${label(source)}: ${describeError(error)}`);
    }
    await sleep(300);
  }
  log(
    `Итог: ISRC ${counts.isrc}, уверенно ${counts.high}, под вопросом ${counts.medium}, не найдено ${counts.none}, ошибок ${counts.error}`,
  );
}

function spotifyQueries(t: Track): string[] {
  const artist = t.artists[0] ?? "";
  return [...(t.isrc ? [`isrc:${t.isrc}`] : []), `track:${t.title} artist:${artist}`, `${artist} ${t.title}`];
}

async function main() {
  log("music-freedom: проверка на живых аккаунтах (только чтение)");
  log(`Дата: ${new Date().toISOString()}, система: ${process.platform}/${process.arch}`);
  const vpn = prompt("VPN сейчас включён? (д/н):")?.trim().toLowerCase();
  log(`VPN: ${vpn?.startsWith("д") || vpn?.startsWith("y") ? "включён" : "выключен"}`);

  const yandex = await connectYandex();
  const spotify = await connectSpotify();

  if (yandex && spotify) {
    log("\n=== Пересечение лайков (пропуск дублей) ===");
    log(`Из лайков Яндекса уже есть в Spotify: ${overlap(yandex.likes, spotify.likes)} из ${yandex.likes.length}`);
    log(`Из лайков Spotify уже есть в Яндексе: ${overlap(spotify.likes, yandex.likes)} из ${spotify.likes.length}`);

    await sampleSearch("Яндекс -> Spotify", yandex.likes, spotify.likes, async (t) => {
      for (const query of spotifyQueries(t)) {
        const found = await spotify.client.searchTracks(query);
        if (bestMatch(t, found)) return found;
      }
      return [];
    });
    await sampleSearch("Spotify -> Яндекс", spotify.likes, yandex.likes, (t) =>
      yandex.client.searchTracks(`${t.artists[0] ?? ""} ${t.title}`),
    );
  } else {
    log("\nСопоставление пропущено: один из сервисов недоступен.");
  }

  const reportPath = join(appDataDir, `probe-report-${Date.now()}.txt`);
  await Bun.write(reportPath, `${report.join("\n")}\n`);
  console.log(`\nОтчёт сохранён: ${reportPath}`);
  console.log("Токены в отчёт не попадают. Пришлите файл отчёта целиком.");
  prompt("Нажмите Enter, чтобы закрыть.");
}

await main();
