import type { PlanItem, PlanSummary } from "../core/plan";
import type { ServiceId, Track } from "../core/track";

export type { PlanItem, PlanSummary, ServiceId, Track };

/** Направление переноса: в одну сторону или синхронизация в обе. */
export type TransferMode = "yandex-spotify" | "spotify-yandex" | "both";

export type ServiceState =
  | { status: "disconnected"; error?: string }
  | { status: "connecting" }
  | { status: "connected"; account: string; likes: number | null; error?: string };

export type YandexState = ServiceState & {
  /** Код для ya.ru/device, пока пользователь не подтвердил вход. */
  pendingCode?: { userCode: string; verificationUrl: string; expiresAt: number };
};

export type SpotifyState = ServiceState & {
  clientId?: string;
  redirectUri: string;
};

export type JobKind = "plan" | "apply" | "undo";

export type JobState = {
  kind: JobKind;
  /** Что происходит сейчас, для подписи под счётчиками. */
  stage: "load-yandex" | "load-spotify" | "match" | "write-yandex" | "write-spotify" | "undo";
  done: number;
  total: number;
};

export type LastRun = {
  id: number;
  added: Partial<Record<ServiceId, number>>;
  undone: boolean;
};

export type AppState = {
  services: { yandex: YandexState; spotify: SpotifyState };
  job: JobState | null;
  /** Последняя ошибка фоновой задачи, пока пользователь её не закрыл. */
  jobError: string | null;
  plan: { mode: TransferMode; version: number; summary: PlanSummary } | null;
  lastRun: LastRun | null;
};

export type RunInfo = {
  id: number;
  createdAt: number;
  undoneAt: number | null;
  added: Partial<Record<ServiceId, number>>;
};
