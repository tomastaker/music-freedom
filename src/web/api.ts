import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, PlanItem, RunInfo } from "../shared/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data;
}

export const api = {
  state: () => request<AppState>("/api/state"),
  planItems: () => request<PlanItem[]>("/api/plan/items"),
  runs: () => request<RunInfo[]>("/api/runs"),
  post: (path: string, body?: unknown) =>
    request<{ ok: true }>(path, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
};

/** Состояние приложения с опросом сервера: чаще, пока идёт работа или ждём вход. */
export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const [offline, setOffline] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(async () => {
    clearTimeout(timer.current);
    let next: AppState | null = null;
    try {
      next = await api.state();
      setState(next);
      setOffline(false);
    } catch {
      setOffline(true);
    }
    const busy =
      next?.job ||
      next?.services.yandex.pendingCode ||
      next?.services.yandex.status === "connecting" ||
      next?.services.spotify.status === "connecting";
    timer.current = setTimeout(refresh, busy ? 300 : 2000);
  }, []);

  useEffect(() => {
    refresh();
    return () => clearTimeout(timer.current);
  }, [refresh]);

  return { state, offline, refresh };
}

/** Строки плана перезагружаются только при смене его версии. */
export function usePlanItems(version: number | undefined) {
  const [items, setItems] = useState<PlanItem[]>([]);
  useEffect(() => {
    if (version === undefined) {
      setItems([]);
      return;
    }
    api.planItems().then(setItems, () => {});
  }, [version]);
  return items;
}
