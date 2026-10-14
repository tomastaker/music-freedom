import type { PlanItem, PlanSummary } from "../../shared/api";
import { t } from "../i18n";
import { Counter } from "./Counter";

export type Filter = "all" | PlanItem["status"];

const METERS: { key: keyof PlanSummary; tone: "amber" | "dim" | "brick" }[] = [
  { key: "add", tone: "amber" },
  { key: "exists", tone: "dim" },
  { key: "review", tone: "amber" },
  { key: "notFound", tone: "brick" },
];

type Props = {
  summary: PlanSummary | null;
  filter: Filter;
  onFilter: (filter: Filter) => void;
};

/** Четыре индикатора итога; нажатие фильтрует таблицу. Сумма всегда равна размеру источника. */
export function Meters({ summary, filter, onFilter }: Props) {
  return (
    <div className="meters">
      {METERS.map(({ key, tone }) => (
        <button
          key={key}
          type="button"
          className="meter"
          aria-pressed={filter === key}
          disabled={!summary}
          onClick={() => onFilter(filter === key ? "all" : key)}
        >
          <span className="meter-label">{t(`meter.${key}`)}</span>
          <Counter
            small
            value={summary ? summary[key] : null}
            tone={tone}
            label={summary ? String(summary[key]) : undefined}
          />
        </button>
      ))}
    </div>
  );
}
