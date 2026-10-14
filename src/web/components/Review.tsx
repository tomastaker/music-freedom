import { ArrowLeft, ArrowSquareOut, Check } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { PlanItem, Track } from "../../shared/api";
import { api } from "../api";
import { t } from "../i18n";
import { duration, fullTitle, trackUrl } from "./format";

type Props = {
  items: PlanItem[];
  /** Конкретный трек из таблицы; без него разбираются все неразобранные спорные. */
  startId?: string;
  onClose: () => void;
  onDecided: () => void;
};

function options(item: PlanItem): Track[] {
  const all = [item.match, ...(item.candidates ?? [])].filter((x): x is Track => Boolean(x));
  return all.filter((track, index) => all.findIndex((other) => other.id === track.id) === index);
}

/** Спорные пары по одной: пара занимает рабочую область, следующая ждёт в одно нажатие. */
export function Review({ items, startId, onClose, onDecided }: Props) {
  // Очередь фиксируется при открытии: решённые пары не должны выпадать из-под счётчика «2 из 5».
  const [queue] = useState(() =>
    startId ? items.filter((i) => i.id === startId) : items.filter((i) => i.status === "review" && !i.decision),
  );
  const [position, setPosition] = useState(0);
  const item = queue[position];
  const choices = item ? options(item) : [];
  const [selected, setSelected] = useState<string | undefined>(choices[0]?.id);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(item ? options(item)[0]?.id : undefined);
    setError(null);
  }, [item]);

  const submit = async (trackId?: string) => {
    if (!item) return;
    try {
      await api.post("/api/plan/decide", { itemId: item.id, trackId });
      onDecided();
      if (position + 1 < queue.length) setPosition(position + 1);
      else onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!item) {
    return (
      <div className="empty">
        <h2>{t("review.done")}</h2>
        <div>
          <button type="button" className="button" onClick={onClose}>
            <ArrowLeft weight="bold" />
            {t("review.back")}
          </button>
        </div>
      </div>
    );
  }

  const targetName = t(`service.${item.to}`);
  return (
    <div className="review">
      <div className="review-source">
        <div className="review-head">
          <h2 className="review-title">{t("review.title", { n: position + 1, total: queue.length })}</h2>
          <button type="button" className="button button-quiet" onClick={onClose}>
            <ArrowLeft weight="bold" />
            {t("review.back")}
          </button>
        </div>
        <div className="review-track">
          <span className="track-title">{fullTitle(item.source)}</span>
          <span className="track-artists">{item.source.artists.join(", ")}</span>
          <span className="duration">
            {duration(item.source.durationMs)}
            {item.source.album ? ` · ${item.source.album}` : ""}
          </span>
        </div>
        <div>
          <a className="button" href={trackUrl(item.source)} target="_blank" rel="noreferrer">
            <ArrowSquareOut weight="bold" />
            {t("review.listen")}
          </a>
        </div>
      </div>
      <form
        className="review-candidates"
        onSubmit={(e) => {
          e.preventDefault();
          submit(selected);
        }}
      >
        <h3 className="review-subhead">{t("review.candidates", { service: targetName })}</h3>
        {choices.length === 0 ? (
          <p className="muted">{t("review.noCandidates")}</p>
        ) : (
          <div className="candidate-list" role="radiogroup">
            {choices.map((track) => {
              const diff = Math.round(Math.abs(track.durationMs - item.source.durationMs) / 1000);
              return (
                <label key={track.id} className="candidate">
                  <input
                    type="radio"
                    name="candidate"
                    checked={selected === track.id}
                    onChange={() => setSelected(track.id)}
                  />
                  <span>
                    <span className="track-title">{fullTitle(track)}</span>
                    <br />
                    <span className="track-artists">
                      {track.artists.join(", ")}
                      {track.album ? ` · ${track.album}` : ""}
                    </span>
                  </span>
                  <span className="candidate-meta">
                    <span className="duration">{duration(track.durationMs)}</span>
                    {diff > 0 && <span className="muted">{t("review.duration", { sec: diff })}</span>}
                    <a href={trackUrl(track)} target="_blank" rel="noreferrer" className="muted">
                      {t("review.listen")}
                    </a>
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="review-actions">
          <button type="submit" className="button button-primary" disabled={!selected}>
            <Check weight="bold" />
            {t("review.accept")}
          </button>
          <button type="button" className="button" onClick={() => submit()}>
            {t("review.skip")}
          </button>
        </div>
      </form>
    </div>
  );
}
