import type { PlanItem, PlanSummary } from "../core/plan";
import type { ServiceId, Track } from "../core/track";
import type { ErrorInfo } from "./errors";

export type { ErrorInfo, PlanItem, PlanSummary, ServiceId, Track };

/** Направление переноса: в одну сторону или синхронизация в обе. */
export type TransferMode = "yandex-spotify" | "spotify-yandex" | "both";

export type ServiceState =
  | { status: "disconnected"; error?: ErrorInfo }
  | { status: "connecting" }
  | { status: "connected"; account: string; likes: number | null; error?: ErrorInfo };

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
  jobError: ErrorInfo | null;
  plan: {
    mode: TransferMode;
    version: number;
    summary: PlanSummary;
    /** Сервис-цель ограничил поиск до этого времени: часть треков не проверена. */
    limitedUntil: number | null;
  } | null;
  lastRun: LastRun | null;
};

export type RunInfo = {
  id: number;
  createdAt: number;
  undoneAt: number | null;
  added: Partial<Record<ServiceId, number>>;
};
