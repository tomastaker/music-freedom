import { type Dictionary, ru } from "./ru";

const dictionary: Dictionary = ru;
const pluralRules = new Intl.PluralRules("ru");

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends object ? Leaves<T[K], `${P}${K}.`> : never;
}[keyof T & string];

export type TextKey = Leaves<Dictionary>;

/** Текст по ключу с подстановкой {параметров}. */
export function t(key: TextKey, params: Record<string, string | number> = {}): string {
  let node: unknown = dictionary;
  for (const part of key.split(".")) node = (node as Record<string, unknown>)[part];
  return String(node).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/** «1 трек», «3 трека», «12 треков». */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const rule = pluralRules.select(n);
  return rule === "one" ? forms[0] : rule === "few" ? forms[1] : forms[2];
}

export const formatNumber = (n: number) => n.toLocaleString("ru-RU");
export const tracks = (n: number) => `${formatNumber(n)} ${plural(n, dictionary.plural.track)}`;
