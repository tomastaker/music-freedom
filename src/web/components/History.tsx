import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RunInfo, ServiceId } from "../../shared/api";
import { api } from "../api";
import { t, tracks } from "../i18n";

const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });

export function addedText(added: Partial<Record<ServiceId, number>>): string {
  return (Object.entries(added) as [ServiceId, number][])
    .filter(([, n]) => n > 0)
    .map(([service, n]) => `${tracks(n)} → ${t(`service.${service}`)}`)
    .join(", ");
}

export function History({ busy, onUndo }: { busy: boolean; onUndo: (id: number) => void }) {
  const [runs, setRuns] = useState<RunInfo[] | null>(null);

  useEffect(() => {
    if (!busy) api.runs().then(setRuns, () => setRuns([]));
  }, [busy]);

  if (runs === null) return null;
  if (runs.length === 0) {
    return (
      <div className="empty">
        <h2>{t("history.title")}</h2>
        <p>{t("history.empty")}</p>
      </div>
    );
  }
  return (
    <div className="history">
      {runs.map((run) => (
        <div className="history-row" key={run.id}>
          <span className="history-date">{dateFormat.format(run.createdAt)}</span>
          <span>{addedText(run.added)}</span>
          {run.undoneAt ? (
            <span className="muted">{t("history.undone")}</span>
          ) : (
            <button type="button" className="button" disabled={busy} onClick={() => onUndo(run.id)}>
              <ArrowCounterClockwise weight="bold" />
              {t("history.undo")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
