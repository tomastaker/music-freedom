import https from "node:https";

export class HttpError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${service}: HTTP ${status}`);
  }
}

export async function readJson<T>(service: string, res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new HttpError(service, res.status, text.slice(0, 500));
  return JSON.parse(text) as T;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch только по IPv4. С включённым VPN у части пользователей IPv6-маршрут до Яндекса рвёт TLS,
 * а fetch в Bun выбирает IPv4 или IPv6 непредсказуемо, поэтому запросы падали через раз.
 */
export function fetchIpv4(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Promise<Response>((resolve, reject) => {
    const req = https.request(url, { method: init.method ?? "GET", headers: init.headers, family: 4 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers }));
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("Таймаут запроса")));
    if (init.body) req.write(init.body);
    req.end();
  });
}
