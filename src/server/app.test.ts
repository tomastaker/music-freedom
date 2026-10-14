import { describe, expect, test } from "bun:test";
import type { MusicService } from "../core/service";
import type { ServiceId, Track } from "../core/track";
import { sleep } from "../lib/http";
import { App } from "./app";
import { Store } from "./db";

const track = (service: ServiceId, id: string, title: string): Track => ({
  service,
  id,
  title,
  artists: ["Band"],
  durationMs: 200_000,
});

/** Сервис в памяти: лайки меняются записью и отменой, как в настоящем. */
function memoryService(id: ServiceId, likes: Track[], catalog: Track[]): MusicService & { likes: Track[] } {
  return {
    id,
    likes,
    async overview() {
      return { account: id, likes: this.likes.length };
    },
    async likedTracks() {
      return [...this.likes];
    },
    async findCandidates(source) {
      return catalog.filter((t) => t.title === source.title);
    },
    async addLikes(tracks, onProgress) {
      for (const [index, t] of tracks.entries()) {
        if (!this.likes.some((l) => l.id === t.id)) this.likes.unshift(t);
        onProgress?.(index + 1);
      }
    },
    async removeLikes(tracks) {
      const ids = new Set(tracks.map((t) => t.id));
      this.likes = this.likes.filter((t) => !ids.has(t.id));
    },
  };
}

async function settle(app: App) {
  for (let i = 0; i < 200 && app.state().job; i++) await sleep(5);
  expect(app.state().jobError).toBeNull();
}

async function setup() {
  const song = track("spotify", "s1", "Song");
  const yandex = memoryService("yandex", [track("yandex", "y1", "Song")], []);
  const spotify = memoryService("spotify", [], [song]);
  const app = new App(new Store(":memory:"));
  await app.startDemo({ yandex, spotify });
  app.startPlan("yandex-spotify");
  await settle(app);
  return { app, spotify, song };
}

describe("запись и отмена", () => {
  test("трек, лайкнутый вручную между сравнением и записью, не попадает в отменяемый журнал", async () => {
    const { app, spotify, song } = await setup();
    spotify.likes = [song];
    app.startApply();
    await settle(app);
    expect(app.state().lastRun?.added.spotify ?? 0).toBe(0);
    expect(app.runs()).toHaveLength(0);
  });

  test("отменённый перенос нельзя отменить второй раз", async () => {
    const { app } = await setup();
    app.startApply();
    await settle(app);
    const runId = app.state().lastRun?.id ?? 0;
    app.startUndo(runId);
    await settle(app);
    expect(() => app.startUndo(runId)).toThrow("уже отменён");
  });
});
