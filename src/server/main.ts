import { openBrowser } from "../lib/open-browser";
import { CALLBACK_PORT } from "../providers/spotify/client";
import type { ServiceId, TransferMode } from "../shared/api";
import { AppError, type ErrorInfo } from "../shared/errors";
import index from "../web/index.html";
import { App } from "./app";
import { Store } from "./db";
import { demoServices } from "./demo";
import { toErrorInfo } from "./errors";

// Интерфейс и callback Spotify живут на одном адресе, который пользователь регистрирует в Spotify Dashboard.
const PORT = CALLBACK_PORT;
const URL_BASE = `http://127.0.0.1:${PORT}/`;

const json = (data: unknown, status = 200) => Response.json(data, { status });

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((host) => `http://${host}`));

type Handler = (req: Request) => Response | Promise<Response>;

/**
 * Защита локального API от чужих сайтов в браузере пользователя. Host закрывает DNS rebinding,
 * Origin не даёт другой странице отправить запрос на запись: браузер всегда ставит его у POST.
 */
function guard(handler: Handler, write = false): Handler {
  return (req) => {
    if (!ALLOWED_HOSTS.has(req.headers.get("host") ?? "")) return new Response("Forbidden", { status: 403 });
    if (write && !ALLOWED_ORIGINS.has(req.headers.get("origin") ?? "")) {
      return json({ error: { code: "foreignOrigin" } satisfies ErrorInfo }, 403);
    }
    return handler(req);
  };
}

/** POST-обработчик: только со страницы приложения, с понятной ошибкой вместо 500. */
function handle(work: (req: Request) => Promise<unknown> | unknown): Handler {
  return guard(async (req: Request) => {
    try {
      return json((await work(req)) ?? { ok: true });
    } catch (error) {
      return json({ error: toErrorInfo(error) }, 400);
    }
  }, true);
}

async function body<T>(req: Request): Promise<T> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) throw new AppError("badRequest");
  return (await req.json()) as T;
}

function isService(value: string): value is ServiceId {
  return value === "yandex" || value === "spotify";
}

function callbackPage(error: ErrorInfo | null): Response {
  const target = error ? `/?error=${encodeURIComponent(JSON.stringify(error))}` : "/";
  return new Response(null, { status: 302, headers: { Location: target } });
}

/** Уже запущенная копия отвечает на своём адресе. На macOS второй сервер может занять тот же порт без ошибки. */
async function alreadyRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${URL_BASE}api/state`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (await alreadyRunning()) {
    console.log(`music-freedom is already running / уже запущено: ${URL_BASE}`);
    openBrowser(URL_BASE);
    return;
  }

  const demo = Boolean(process.env.MF_DEMO);
  // Демо пишет кэш и историю в отдельную базу, чтобы не смешивать с настоящими.
  const app = new App(demo ? new Store(":memory:") : new Store());

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: PORT,
      development: process.env.NODE_ENV !== "production" && { hmr: true },
      routes: {
        "/": index,
        "/api/state": { GET: guard(() => json(app.state())) },
        "/api/plan/items": { GET: guard(() => json(app.planItems())) },
        "/api/runs": { GET: guard(() => json(app.runs())) },
        "/api/yandex/login": { POST: handle(() => app.startYandexLogin()) },
        "/api/yandex/login/cancel": { POST: handle(() => app.cancelYandexLogin()) },
        "/api/spotify/client-id": {
          POST: handle(async (req) => app.setSpotifyClientId((await body<{ clientId: string }>(req)).clientId.trim())),
        },
        "/api/spotify/login": {
          GET: guard(async () => {
            try {
              return Response.redirect(await app.spotifyAuthUrl(), 302);
            } catch (error) {
              return callbackPage(toErrorInfo(error, "spotify"));
            }
          }),
        },
        "/callback": {
          GET: guard(async (req) => {
            try {
              await app.finishSpotifyLogin(new URL(req.url).searchParams);
              return callbackPage(null);
            } catch (error) {
              return callbackPage(toErrorInfo(error, "spotify"));
            }
          }),
        },
        "/api/services/:id/disconnect": {
          POST: handle((req) => {
            const id = (req as Request & { params: { id: string } }).params.id;
            if (!isService(id)) throw new AppError("badRequest");
            return app.disconnect(id);
          }),
        },
        "/api/services/:id/retry": {
          POST: handle((req) => {
            const id = (req as Request & { params: { id: string } }).params.id;
            if (!isService(id)) throw new AppError("badRequest");
            return app.retry(id);
          }),
        },
        "/api/plan": {
          POST: handle(async (req) => app.startPlan((await body<{ mode: TransferMode }>(req)).mode)),
        },
        "/api/plan/decide": {
          POST: handle(async (req) => {
            const { itemId, trackId } = await body<{ itemId: string; trackId?: string }>(req);
            app.decide(itemId, trackId ? { trackId } : "skip");
          }),
        },
        "/api/apply": { POST: handle(() => app.startApply()) },
        "/api/job/cancel": { POST: handle(() => app.cancelJob()) },
        "/api/job/dismiss-error": { POST: handle(() => app.dismissError()) },
        "/api/runs/:id/undo": {
          POST: handle((req) => app.startUndo(Number((req as Request & { params: { id: string } }).params.id))),
        },
      },
      fetch: () => new Response("Не найдено", { status: 404 }),
    });
  } catch (error) {
    // Нашей копии на порту нет (проверили выше): его заняла другая программа или система.
    fail(
      `Port ${PORT} is used by another program. Close it and start music-freedom again.\n` +
        `Порт ${PORT} занят другой программой. Закройте её и запустите music-freedom снова.`,
      error,
    );
    return;
  }

  console.log(`music-freedom is running / работает: ${server.url}`);
  console.log("Keep this window open while you use the app. / Не закрывайте это окно, пока пользуетесь программой.");
  if (!process.env.MF_NO_OPEN) openBrowser(URL_BASE);
  if (demo) await app.startDemo(demoServices());
  else await app.start();
}

/**
 * Фатальная ошибка при запуске. На Windows окно консоли закрывается сразу после выхода,
 * поэтому ждём Enter: иначе пользователь не увидит, что случилось.
 */
function fail(message: string, error?: unknown): void {
  console.error(`\n${message}`);
  if (error) console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  prompt("\nPress Enter to close / Нажмите Enter, чтобы закрыть");
  process.exit(1);
}

try {
  await main();
} catch (error) {
  fail("music-freedom could not start. / music-freedom не смогла запуститься.", error);
}
