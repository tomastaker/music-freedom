import { describe, expect, test } from "bun:test";
import { buildPlan, type CachedMatch, decide, type MatchCache, summarize, tracksToAdd } from "./plan";
import type { MusicService } from "./service";
import type { ServiceId, Track } from "./track";

const track = (service: ServiceId, id: string, title: string, artist: string): Track => ({
  service,
  id,
  title,
  artists: [artist],
  durationMs: 200_000,
});

function fakeService(id: ServiceId, likes: Track[], catalog: Track[]): MusicService & { searches: number } {
  return {
    id,
    searches: 0,
    async overview() {
      return { account: id, likes: likes.length };
    },
    async likedTracks() {
      return likes;
    },
    async findCandidates(source) {
      this.searches++;
      return catalog.filter((t) => t.title.toLowerCase() === source.title.toLowerCase());
    },
    async addLikes() {},
    async removeLikes() {},
  };
}

function memoryCache(): MatchCache {
  const map = new Map<string, CachedMatch>();
  return {
    get: (from, sourceId, to) => map.get(`${from}:${sourceId}:${to}`),
    set: (from, sourceId, to, value) => void map.set(`${from}:${sourceId}:${to}`, value),
  };
}

const toSpotify = [{ from: "yandex", to: "spotify" }] as const;

describe("buildPlan", () => {
  test("трек, который уже есть в цели, пропускается без поиска", async () => {
    const yandex = fakeService("yandex", [track("yandex", "y1", "Кукловод", "РАССВЕТОВ")], []);
    const spotify = fakeService("spotify", [track("spotify", "s1", "Кукловод", "РАССВЕТОВ")], []);
    const plan = await buildPlan({ services: { yandex, spotify }, directions: [...toSpotify], cache: memoryCache() });
    expect(plan.items[0]?.status).toBe("exists");
    expect(spotify.searches).toBe(0);
  });

  test("запись идёт от старых лайков к новым", async () => {
    // Сервисы отдают лайки от новых к старым.
    const yandex = fakeService(
      "yandex",
      [track("yandex", "new", "Новый", "A"), track("yandex", "old", "Старый", "A")],
      [],
    );
    const spotify = fakeService(
      "spotify",
      [],
      [track("spotify", "sNew", "Новый", "A"), track("spotify", "sOld", "Старый", "A")],
    );
    const plan = await buildPlan({ services: { yandex, spotify }, directions: [...toSpotify], cache: memoryCache() });
    expect(tracksToAdd(plan)[0]?.items.map((i) => i.match?.id)).toEqual(["sOld", "sNew"]);
  });

  test("два трека источника, найденные как один трек цели, добавляются один раз", async () => {
    const yandex = fakeService(
      "yandex",
      [track("yandex", "y1", "Blade", "DJ Kuba"), track("yandex", "y2", "Blade", "DJ Kuba")],
      [],
    );
    const spotify = fakeService("spotify", [], [track("spotify", "s1", "Blade", "DJ Kuba")]);
    const plan = await buildPlan({ services: { yandex, spotify }, directions: [...toSpotify], cache: memoryCache() });
    expect(summarize(plan)).toMatchObject({ add: 1, exists: 1 });
  });

  test("повторное сравнение берёт найденное из кэша, а не ищет заново", async () => {
    const cache = memoryCache();
    const yandex = fakeService("yandex", [track("yandex", "y1", "Artillery", "Infected Mushroom")], []);
    const spotify = fakeService("spotify", [], [track("spotify", "s1", "Artillery", "Infected Mushroom")]);
    await buildPlan({ services: { yandex, spotify }, directions: [...toSpotify], cache });
    await buildPlan({ services: { yandex, spotify }, directions: [...toSpotify], cache });
    expect(spotify.searches).toBe(1);
  });

  test("подтверждённый вручную кандидат попадает в запись", async () => {
    const yandex = fakeService("yandex", [track("yandex", "y1", "Winston", "DNK")], []);
    const other = track("spotify", "s9", "Winston (Live)", "DNK");
    const spotify: MusicService = { ...fakeService("spotify", [], []), findCandidates: async () => [other] };
    const plan = await buildPlan({ services: { yandex, spotify }, directions: [...toSpotify], cache: memoryCache() });
    const item = plan.items[0];
    expect(item?.status).toBe("notFound");
    decide(plan, item?.id ?? "", { trackId: "s9" });
    expect(tracksToAdd(plan)[0]?.items.map((i) => i.match?.id)).toEqual(["s9"]);
  });

  test("вручную выбранный трек, который уже лайкнут под другим названием, не записывается", async () => {
    const live = track("spotify", "s-live", "Song (Live at Wembley)", "Band");
    const yandex = fakeService("yandex", [track("yandex", "y1", "Song", "Band")], []);
    const spotify: MusicService = { ...fakeService("spotify", [live], []), findCandidates: async () => [live] };
    const plan = await buildPlan({ services: { yandex, spotify }, directions: [...toSpotify], cache: memoryCache() });
    decide(plan, plan.items[0]?.id ?? "", { trackId: "s-live" });
    expect(tracksToAdd(plan)[0]?.items).toHaveLength(0);
    expect(summarize(plan)).toMatchObject({ add: 0, exists: 1 });
  });

  test("пропущенный трек не записывается", async () => {
    const yandex = fakeService("yandex", [track("yandex", "y1", "Танцевать", "Мураками")], []);
    const spotify = fakeService(
      "spotify",
      [],
      [{ ...track("spotify", "s1", "Танцевать", "Мураками"), durationMs: 209_000 }],
    );
    const plan = await buildPlan({ services: { yandex, spotify }, directions: [...toSpotify], cache: memoryCache() });
    expect(plan.items[0]?.status).toBe("review");
    decide(plan, plan.items[0]?.id ?? "", "skip");
    expect(tracksToAdd(plan)[0]?.items).toHaveLength(0);
  });

  test("один трек, выбранный для двух строк, записывается, даже если одну строку потом пропустили", async () => {
    const x = track("spotify", "sx", "Песня (концерт)", "Band");
    const yandex = fakeService(
      "yandex",
      [track("yandex", "y1", "Песня", "Band"), track("yandex", "y2", "Песня", "Band")],
      [],
    );
    const spotify: MusicService = { ...fakeService("spotify", [], []), findCandidates: async () => [x] };
    const plan = await buildPlan({ services: { yandex, spotify }, directions: [...toSpotify], cache: memoryCache() });
    const [first, second] = plan.items;
    decide(plan, first?.id ?? "", { trackId: "sx" });
    decide(plan, second?.id ?? "", { trackId: "sx" });
    decide(plan, first?.id ?? "", "skip");
    expect(tracksToAdd(plan)[0]?.items.map((i) => i.match?.id)).toEqual(["sx"]);
  });
});
