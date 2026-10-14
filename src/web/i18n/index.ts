import { useSyncExternalStore } from "react";
import type { ErrorInfo } from "../../shared/errors";
import { en } from "./en";
import { type Dictionary, ru } from "./ru";

export type Locale = "en" | "ru";
export const LOCALES: Locale[] = ["en", "ru"];

const dictionaries: Record<Locale, Dictionary> = { en, ru };
const STORAGE_KEY = "music-freedom.locale";

function initialLocale(): Locale {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "ru") return saved;
  const preferred = typeof navigator === "undefined" ? [] : navigator.languages;
  return preferred.some((lang) => lang.toLowerCase().startsWith("ru")) ? "ru" : "en";
}

let locale: Locale = initialLocale();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = locale;

export function setLocale(next: Locale): void {
  locale = next;
  localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

/** Текущий язык; компонент перерисовывается при переключении. */
export function useLocale(): Locale {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => locale,
  );
}

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends object ? Leaves<T[K], `${P}${K}.`> : never;
}[keyof T & string];

export type TextKey = Exclude<Leaves<Dictionary>, `plural.${string}`>;

/** Текст по ключу с подстановкой {параметров}. */
export function t(key: TextKey, params: Record<string, string | number> = {}): string {
  let node: unknown = dictionaries[locale];
  for (const part of key.split(".")) node = (node as Record<string, unknown>)[part];
  return String(node).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

const localeTag = () => (locale === "ru" ? "ru-RU" : "en-US");

export const formatNumber = (n: number) => n.toLocaleString(localeTag());

export const formatDateTime = (time: number, style: "short" | "full" = "short") =>
  new Date(time).toLocaleString(
    localeTag(),
    style === "short"
      ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
      : { dateStyle: "medium", timeStyle: "short" },
  );

/** «1 трек», «3 трека», «12 треков» / «1 track», «12 tracks». */
export function tracks(n: number): string {
  const rule = new Intl.PluralRules(localeTag()).select(n) as keyof Dictionary["plural"]["track"];
  const forms = dictionaries[locale].plural.track;
  return `${formatNumber(n)} ${forms[rule] ?? forms.other}`;
}

/** Ошибка от сервера словами текущего языка. */
export function errorText(error: ErrorInfo): string {
  const params: Record<string, string | number> = {
    service: error.service ? t(`service.${error.service}`) : t("errors.someService"),
    ...error.params,
  };
  if (typeof error.params?.until === "number") params.until = formatDateTime(error.params.until);
  return t(`errors.${error.code}`, params);
}
