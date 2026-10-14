import type { ServiceId } from "../core/track";

/**
 * Ошибки уходят в интерфейс кодом с параметрами, а не готовой фразой:
 * текст на нужном языке собирает словарь интерфейса.
 */
export type ErrorCode =
  | "busy"
  | "badClientId"
  | "noClientId"
  | "loginStale"
  | "loginCancelled"
  | "loginRejected"
  | "missingScope"
  | "spotifyForbidden"
  | "notConnected"
  | "needBoth"
  | "needCompare"
  | "noRun"
  | "runUndone"
  | "undoNeedsService"
  | "badRequest"
  | "foreignOrigin"
  | "yandexCodeExpired"
  | "decisionNotNeeded"
  | "noSuchCandidate"
  | "rateLimited"
  | "authExpired"
  | "geoBlocked"
  | "noScopeForAction"
  | "slowDown"
  | "serviceDown"
  | "serviceError"
  | "network"
  | "stopped"
  | "unknown";

export type ErrorInfo = {
  code: ErrorCode;
  service?: ServiceId;
  params?: Record<string, string | number>;
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly service?: ServiceId,
    readonly params?: Record<string, string | number>,
  ) {
    super(code);
    this.name = "AppError";
  }
}
