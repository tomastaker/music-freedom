import { describe, expect, test } from "bun:test";
import { compare } from "./match";
import type { Track } from "./track";

const yandex = (t: Partial<Track>): Track => ({
  service: "yandex",
  id: "y",
  title: "",
  artists: [],
  durationMs: 200_000,
  ...t,
});
const spotify = (t: Partial<Track>): Track => ({
  service: "spotify",
  id: "s",
  title: "",
  artists: [],
  durationMs: 200_000,
  ...t,
});

describe("compare", () => {
  test("одинаковый ISRC побеждает любые расхождения в подписи", () => {
    expect(compare(yandex({ title: "A", isrc: "gbaye0601498" }), spotify({ title: "B", isrc: "GBAYE0601498" }))).toBe(
      "isrc",
    );
  });

  test("кириллица в одном сервисе и транслит в другом", () => {
    expect(
      compare(
        yandex({ title: "Группа крови", artists: ["Кино"] }),
        spotify({ title: "Gruppa krovi", artists: ["Kino"] }),
      ),
    ).toBe("high");
  });

  test("ремастер: в Spotify в названии, в Яндексе в поле версии", () => {
    expect(
      compare(
        yandex({ title: "Here Comes The Sun", version: "Remastered 2019", artists: ["The Beatles"] }),
        spotify({ title: "Here Comes The Sun - Remastered 2019", artists: ["The Beatles"] }),
      ),
    ).toBe("high");
  });

  test("live-версия не совпадает со студийной", () => {
    expect(
      compare(
        yandex({ title: "Creep", artists: ["Radiohead"] }),
        spotify({ title: "Creep - Live", artists: ["Radiohead"] }),
      ),
    ).toBeNull();
  });

  test("live-версия совпадает с live-версией, как бы её ни подписали", () => {
    expect(
      compare(
        yandex({ title: "Creep", version: "Live", artists: ["Radiohead"] }),
        spotify({ title: "Creep - Live", artists: ["Radiohead"] }),
      ),
    ).toBe("high");
  });

  test("слово with в названии не считается пометкой о соавторе", () => {
    expect(
      compare(
        yandex({ title: "Dancing with Myself", artists: ["Billy Idol"] }),
        spotify({ title: "Dancing", artists: ["Billy Idol"] }),
      ),
    ).toBeNull();
  });

  test("соавтор в скобках не мешает совпадению", () => {
    expect(
      compare(
        yandex({ title: "Stay", artists: ["The Kid LAROI", "Justin Bieber"] }),
        spotify({ title: "Stay (with Justin Bieber)", artists: ["The Kid LAROI"] }),
      ),
    ).toBe("high");
  });

  test("Featuring полным словом в скобках, как в Яндексе", () => {
    expect(
      compare(
        yandex({ title: "Broken (Featuring Amy Lee)", artists: ["Seether", "Amy Lee"] }),
        spotify({ title: "Broken", artists: ["Seether", "Amy Lee"], durationMs: 201_000 }),
      ),
    ).toBe("high");
  });

  test("заметная разница в длительности снижает уверенность", () => {
    expect(
      compare(
        yandex({ title: "Song", artists: ["X"], durationMs: 200_000 }),
        spotify({ title: "Song", artists: ["X"], durationMs: 210_000 }),
      ),
    ).toBe("medium");
  });
});
