import type { ServiceId } from "../core/track";
import { HttpError, RateLimitError } from "../lib/http";

const NAMES: Record<ServiceId, string> = { yandex: "Яндекс Музыка", spotify: "Spotify" };
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ConnectionRefused",
  "ConnectionClosed",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR",
]);

/** Ошибка сервиса словами пользователя: что случилось и что сделать. */
export function userMessage(error: unknown, service?: ServiceId): string {
  const name = service ? NAMES[service] : error instanceof HttpError ? error.service : "Сервис";
  if (error instanceof DOMException && error.name === "AbortError") return "Остановлено.";
  if (error instanceof RateLimitError) {
    const until = new Date(error.retryAt).toLocaleString("ru-RU", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${error.service} ограничил запросы вашего приложения до ${until}. Всё найденное сохранено: после этого времени нажмите «Сравнить», и поиск продолжится с того же места.`;
  }
  if (error instanceof HttpError) {
    if (error.status === 401) return `Вход в ${name} устарел. Отключите сервис и подключите заново.`;
    if (error.body.includes("unavailable in this country")) {
      return `${name} недоступен из вашей страны. Включите VPN и нажмите «Повторить».`;
    }
    if (error.status === 403 && /scope/i.test(error.body)) {
      return `У программы нет права на это действие в ${name}. Отключите сервис и войдите заново.`;
    }
    if (error.status === 429) return `${name} просит сделать паузу. Подождите минуту и повторите.`;
    if (error.status === 403 && service === "spotify") {
      return "Spotify отказал в доступе. Проверьте, что у владельца приложения в Spotify Dashboard есть Premium.";
    }
    if (error.status === 451)
      return `${name} недоступен из вашей страны. Попробуйте включить или выключить VPN и нажмите «Повторить».`;
    if (error.status >= 500) return `${name} временно не работает (ошибка ${error.status}). Попробуйте позже.`;
    return `${name} ответил ошибкой ${error.status}.`;
  }
  const code = (error as { code?: string } | null)?.code;
  if (code && NETWORK_CODES.has(code)) {
    return `${name} не отвечает. Проверьте интернет; если включён VPN, попробуйте другой сервер. Затем нажмите «Повторить».`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Вход больше недействителен: нужно подключаться заново, повтор не поможет. */
export function isAuthError(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 401 || error.status === 400);
}
