import { afterEach, expect, test } from "bun:test";
import { RateLimitError } from "../../lib/http";
import { SpotifyClient } from "./client";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("долгое ограничение Spotify сразу прерывает работу, а не ждёт сутки", async () => {
  globalThis.fetch = (async () =>
    new Response('{"error":{"status":429,"reason":"QUOTA_EXCEEDED"}}', {
      status: 429,
      headers: { "retry-after": "82168" },
    })) as unknown as typeof fetch;
  const client = new SpotifyClient(async () => "token");
  const started = Date.now();
  const error = await client.searchTracks("test").catch((e) => e);
  expect(error).toBeInstanceOf(RateLimitError);
  expect((error as RateLimitError).retryAt - started).toBeGreaterThan(82_000_000);
  expect(Date.now() - started).toBeLessThan(2000);
});
