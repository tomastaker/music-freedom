import { RateLimitError } from "../lib/http";
import { AppError } from "../shared/errors";
import { bestMatch, LibraryIndex, type MatchLevel } from "./match";
import type { MusicService } from "./service";
import type { ServiceId, Track } from "./track";

export type Direction = { from: ServiceId; to: ServiceId };

/**
 * add — найден и будет добавлен; exists — уже есть в цели, пропускается;
 * review — похож, но нужно подтверждение; notFound — в каталоге цели не нашёлся.
 */
export type PlanItemStatus = "add" | "exists" | "review" | "notFound";

export type PlanItem = {
  id: string;
  from: ServiceId;
  to: ServiceId;
  source: Track;
  status: PlanItemStatus;
  /** Трек в целевом сервисе, который будет добавлен или уже есть. */
  match?: Track;
  level?: MatchLevel;
  /** Варианты для ручного выбора: у спорных и ненайденных. */
  candidates?: Track[];
  /** Решение пользователя по спорному или ненайденному треку. */
  decision?: "accepted" | "skipped";
  /** Записан последним переносом. */
  added?: boolean;
  /** Поиск не выполнялся: сервис временно ограничил запросы. Досравнивается позже. */
  unchecked?: boolean;
};

export type Plan = {
  directions: Direction[];
  /** Размер избранного в каждом сервисе на момент сравнения. */
  libraries: Partial<Record<ServiceId, number>>;
  /** Идентификаторы уже лайкнутых треков: ручной выбор не должен записать то, что уже есть. */
  likedIds: Partial<Record<ServiceId, string[]>>;
  /** До какого момента сервис-цель ограничил поиск, если сравнение остановилось на нём. */
  limitedUntil: Partial<Record<ServiceId, number>>;
  items: PlanItem[];
};

export type CachedMatch = { target: Track | null; level?: MatchLevel; candidates?: Track[] };

/** Запомненные результаты поиска: повторная синхронизация не ищет заново то, что уже нашлось. */
export interface MatchCache {
  get(from: ServiceId, sourceId: string, to: ServiceId): CachedMatch | undefined;
  set(from: ServiceId, sourceId: string, to: ServiceId, value: CachedMatch): void;
}

export type PlanProgress =
  | { phase: "load"; service: ServiceId; loaded: number; total: number }
  | { phase: "match"; done: number; total: number };

export type Services = Partial<Record<ServiceId, MusicService>>;

function service(services: Services, id: ServiceId): MusicService {
  const found = services[id];
  if (!found) throw new AppError("notConnected", id);
  return found;
}

export async function buildPlan(options: {
  services: Services;
  directions: Direction[];
  cache: MatchCache;
  onProgress?: (progress: PlanProgress) => void;
  signal?: AbortSignal;
}): Promise<Plan> {
  const { services, directions, cache, onProgress, signal } = options;
  const involved = [...new Set(directions.flatMap((d) => [d.from, d.to]))];
  const likes = new Map<ServiceId, Track[]>();
  for (const id of involved) {
    signal?.throwIfAborted();
    likes.set(
      id,
      await service(services, id).likedTracks((loaded, total) =>
        onProgress?.({ phase: "load", service: id, loaded, total }),
      ),
    );
  }

  const items: PlanItem[] = [];
  const limitedUntil: Plan["limitedUntil"] = {};
  const total = directions.reduce((sum, d) => sum + (likes.get(d.from)?.length ?? 0), 0);
  let done = 0;
  for (const { from, to } of directions) {
    const targetLikes = likes.get(to) ?? [];
    const index = new LibraryIndex(targetLikes);
    const likedIds = new Set(targetLikes.map((t) => t.id));
    const plannedIds = new Set<string>();
    const target = service(services, to);

    for (const source of likes.get(from) ?? []) {
      signal?.throwIfAborted();
      const item: PlanItem = { id: `${from}:${source.id}:${to}`, from, to, source, status: "notFound" };
      const present = index.find(source);
      if (present) {
        Object.assign(item, { status: "exists", match: present.candidate, level: present.level });
      } else {
        let found = cache.get(from, source.id, to);
        if (!found && limitedUntil[to] === undefined) {
          try {
            const candidates = await target.findCandidates(source);
            const best = bestMatch(source, candidates);
            found = { target: best?.candidate ?? null, level: best?.level, candidates: candidates.slice(0, 5) };
            cache.set(from, source.id, to, found);
          } catch (error) {
            // Ограничение на сутки не должно отнимать уже найденное: план собирается частично.
            if (!(error instanceof RateLimitError)) throw error;
            limitedUntil[to] = error.retryAt;
          }
        }
        if (!found) {
          item.unchecked = true;
        } else if (found.target && (likedIds.has(found.target.id) || plannedIds.has(found.target.id))) {
          // Два трека источника свелись к одному треку цели: добавляем его один раз.
          Object.assign(item, { status: "exists", match: found.target, level: found.level });
        } else if (found.target && found.level !== "medium") {
          Object.assign(item, { status: "add", match: found.target, level: found.level });
          plannedIds.add(found.target.id);
        } else if (found.target) {
          Object.assign(item, {
            status: "review",
            match: found.target,
            level: found.level,
            candidates: found.candidates,
          });
        } else {
          item.candidates = found.candidates;
        }
      }
      items.push(item);
      onProgress?.({ phase: "match", done: ++done, total });
    }
  }

  return {
    directions,
    libraries: Object.fromEntries([...likes].map(([id, tracks]) => [id, tracks.length])),
    likedIds: Object.fromEntries([...likes].map(([id, tracks]) => [id, tracks.map((t) => t.id)])),
    limitedUntil,
    items,
  };
}

/** Решение пользователя по спорному или ненайденному треку: выбрать кандидата или пропустить. */
export function decide(plan: Plan, itemId: string, choice: { trackId: string } | "skip"): PlanItem {
  const item = plan.items.find((i) => i.id === itemId);
  if (!item) throw new AppError("noSuchCandidate");
  if (item.status !== "review" && item.status !== "notFound") {
    throw new AppError("decisionNotNeeded");
  }
  if (choice === "skip") {
    item.decision = "skipped";
    return item;
  }
  const picked = [item.match, ...(item.candidates ?? [])].find((t) => t?.id === choice.trackId);
  if (!picked) throw new AppError("noSuchCandidate");
  item.match = picked;
  // Статус не меняем: выбор можно пересмотреть, а повторы и уже лайкнутое отсеет tracksToAdd.
  item.decision = "accepted";
  return item;
}

/** Треки, которые запись добавит в каждый сервис, от старых к новым, без уже лайкнутых и без повторов. */
export function tracksToAdd(plan: Plan): { to: ServiceId; items: PlanItem[] }[] {
  return plan.directions.map(({ from, to }) => {
    const liked = new Set(plan.likedIds[to] ?? []);
    const seen = new Set<string>();
    const items = plan.items
      .filter((i) => i.from === from && i.to === to && i.match && i.decision !== "skipped")
      .filter((i) => i.status === "add" || i.decision === "accepted")
      .reverse()
      .filter((i) => {
        const id = i.match?.id ?? "";
        if (liked.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    return { to, items };
  });
}

export type PlanSummary = Record<"add" | "exists" | "review" | "notFound" | "unchecked", number>;

/** Сводка совпадает с тем, что реально запишется: повторы и уже лайкнутое считаются «уже есть». */
export function summarize(plan: Plan): PlanSummary {
  const toWrite = new Set(tracksToAdd(plan).flatMap((group) => group.items.map((i) => i.id)));
  const summary: PlanSummary = { add: 0, exists: 0, review: 0, notFound: 0, unchecked: 0 };
  for (const item of plan.items) {
    if (item.unchecked) summary.unchecked++;
    else if (toWrite.has(item.id)) summary.add++;
    else if (item.decision === "skipped") summary.notFound++;
    else if (item.status === "review" && !item.decision) summary.review++;
    else if (item.status === "notFound" && !item.decision) summary.notFound++;
    else summary.exists++;
  }
  return summary;
}
