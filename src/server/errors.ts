import type { ServiceId } from "../core/track";
import { HttpError, RateLimitError } from "../lib/http";
import { AppError, type ErrorInfo } from "../shared/errors";

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ConnectionRefused",
  "ConnectionClosed",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR",
  "TimeoutError",
]);

const asService = (value: string | undefined): ServiceId | undefined =>
  value === "yandex" || value === "spotify" ? value : undefined;

/** Исключение в код для интерфейса: что случилось и с каким сервисом. Текст собирает словарь интерфейса. */
export function toErrorInfo(error: unknown, service?: ServiceId): ErrorInfo {
  if (error instanceof AppError) return { code: error.code, service: error.service ?? service, params: error.params };
  if (error instanceof DOMException && error.name === "AbortError") return { code: "stopped" };
  if (error instanceof RateLimitError) {
    return { code: "rateLimited", service: asService(error.service) ?? service, params: { until: error.retryAt } };
  }
  if (error instanceof HttpError) {
    const who = service ?? asService(error.service);
    if (error.status === 401) return { code: "authExpired", service: who };
    if (error.body.includes("unavailable in this country") || error.status === 451)
      return { code: "geoBlocked", service: who };
    if (error.status === 403 && /scope/i.test(error.body)) return { code: "noScopeForAction", service: who };
    if (error.status === 429) return { code: "slowDown", service: who };
    if (error.status === 403 && who === "spotify") return { code: "spotifyForbidden", service: who };
    if (error.status >= 500) return { code: "serviceDown", service: who, params: { status: error.status } };
    return { code: "serviceError", service: who, params: { status: error.status } };
  }
  const code = (error as { code?: string; name?: string } | null)?.code ?? (error as { name?: string })?.name;
  if (code && NETWORK_CODES.has(code)) return { code: "network", service };
  return { code: "unknown", service, params: { message: error instanceof Error ? error.message : String(error) } };
}

/** Вход больше недействителен: нужно подключаться заново, повтор не поможет. */
export function isAuthError(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 401 || error.status === 400);
}
