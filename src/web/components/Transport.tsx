import { ArrowsClockwise, Stop } from "@phosphor-icons/react";
import type { TransferMode } from "../../shared/api";
import { formatNumber, t } from "../i18n";

const MODES: TransferMode[] = ["yandex-spotify", "spotify-yandex", "both"];

type Props = {
  mode: TransferMode;
  onMode: (mode: TransferMode) => void;
  ready: boolean;
  /** Оба подключены, но у одного ошибка: сначала «Повторить». */
  blocked: boolean;
  running: boolean;
  /** Сравнение для выбранного направления уже есть. */
  compared: boolean;
  toAdd: number;
  toReview: number;
  onCompare: () => void;
  onRecord: () => void;
  onStop: () => void;
};

export function Transport(props: Props) {
  const { mode, onMode, ready, running, compared, toAdd, toReview } = props;
  const canRecord = ready && compared && toAdd > 0 && !running;
  const hint = !ready
    ? props.blocked
      ? t("action.needHealthy")
      : t("action.needBoth")
    : running
      ? ""
      : !compared
        ? t("action.needCompare")
        : toAdd === 0
          ? t("action.nothingToAdd")
          : toReview > 0
            ? t("action.reviewLeft", { n: toReview })
            : "";

  return (
    <div className="transport">
      <fieldset className="segmented" disabled={running}>
        <legend className="visually-hidden">{t("mode.label")}</legend>
        {MODES.map((value) => (
          <label key={value} className="segment">
            <input
              type="radio"
              name="mode"
              className="visually-hidden"
              checked={mode === value}
              onChange={() => onMode(value)}
            />
            {t(`mode.${value}`)}
          </label>
        ))}
      </fieldset>
      <div className="transport-buttons">
        <button type="button" className="button" disabled={!ready || running} onClick={props.onCompare}>
          <ArrowsClockwise weight="bold" />
          {compared ? t("action.compareAgain") : t("action.compare")}
        </button>
        {running ? (
          <button type="button" className="rec-button" onClick={props.onStop}>
            <Stop weight="fill" />
            {t("action.stop")}
          </button>
        ) : (
          <button type="button" className="rec-button" disabled={!canRecord} onClick={props.onRecord}>
            <span>{t("action.record")}</span>
            <span className="rec-count">{compared && toAdd > 0 ? formatNumber(toAdd) : "-"}</span>
          </button>
        )}
      </div>
      <p className="transport-hint" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}
