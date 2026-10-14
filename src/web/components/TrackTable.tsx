import { Check, MagnifyingGlass, Minus, Question, X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { PlanItem } from "../../shared/api";
import { t } from "../i18n";
import { duration, fullTitle } from "./format";
import type { Filter } from "./Meters";

const LIMIT = 300;
// Сначала то, что требует внимания или изменится, в конце то, что уже на месте.
const ORDER: Record<PlanItem["status"], number> = { review: 0, add: 1, notFound: 2, exists: 3 };

function effectiveStatus(item: PlanItem): PlanItem["status"] {
  if (item.decision === "accepted") return "add";
  if (item.decision === "skipped") return "notFound";
  return item.status;
}

function StatusLabel({ item }: { item: PlanItem }) {
  const status = effectiveStatus(item);
  const icon = {
    add: <Check weight="bold" />,
    exists: <Minus weight="bold" />,
    review: <Question weight="bold" />,
    notFound: <X weight="bold" />,
  }[status];
  if (item.added) {
    return (
      <span className="status" data-status="add">
        <Check weight="bold" />
        {t("table.added")}
      </span>
    );
  }
  const text =
    item.decision === "accepted"
      ? t("table.accepted")
      : item.decision === "skipped"
        ? t("table.skipped")
        : status === "notFound"
          ? t("table.notInCatalog")
          : t(`meter.${status}`);
  return (
    <span className="status" data-status={status}>
      {icon}
      {text}
    </span>
  );
}

const TABS: Filter[] = ["all", "review", "add", "notFound", "exists"];
// Те же цвета, что у индикаторов над таблицей: одно число — один цвет.
const TONES: Record<Filter, string> = { all: "dim", review: "amber", add: "amber", notFound: "brick", exists: "dim" };

type Props = {
  items: PlanItem[];
  filter: Filter;
  onFilter: (filter: Filter) => void;
  showDirection: boolean;
  onReview: (itemId?: string) => void;
};

export function TrackTable({ items, filter, onFilter, showDirection, onReview }: Props) {
  const [query, setQuery] = useState("");
  const pendingReview = items.filter((i) => i.status === "review" && !i.decision).length;
  const count = (tab: Filter) =>
    tab === "all" ? items.length : items.filter((i) => effectiveStatus(i) === tab).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...items].sort(
      (a, b) =>
        Number(Boolean(b.added)) - Number(Boolean(a.added)) || ORDER[effectiveStatus(a)] - ORDER[effectiveStatus(b)],
    );
    return sorted.filter((item) => {
      if (filter !== "all" && effectiveStatus(item) !== filter) return false;
      if (!q) return true;
      return [item.source.title, ...item.source.artists].some((s) => s.toLowerCase().includes(q));
    });
  }, [items, filter, query]);

  return (
    <>
      <div className="table-bar">
        <fieldset className="filter-tabs">
          <legend className="visually-hidden">{t("table.filters")}</legend>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className="filter-tab"
              aria-pressed={filter === tab}
              onClick={() => onFilter(tab)}
            >
              {tab === "all" ? t("table.filterAll") : t(`meter.${tab}`)}
              <span className="filter-count" data-tone={TONES[tab]}>
                {count(tab)}
              </span>
            </button>
          ))}
        </fieldset>
        <div className="search">
          <MagnifyingGlass />
          <input
            className="input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("table.search")}
            aria-label={t("table.search")}
          />
        </div>
        {pendingReview > 0 && (
          <button type="button" className="button" onClick={() => onReview()}>
            <Question weight="bold" />
            {t("table.reviewAll")} · {pendingReview}
          </button>
        )}
      </div>
      <div className="table-wrap">
        {visible.length === 0 ? (
          <p className="table-empty">{t("table.empty")}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">{t("table.from")}</th>
                <th scope="col">{t("table.to")}</th>
                <th scope="col">{t("table.status")}</th>
                <th scope="col">
                  <span className="visually-hidden">{t("table.choose")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, LIMIT).map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="track-cell">
                      {showDirection && <span className="service-dot" data-service={item.from} />}
                      <div>
                        <div className="track-title">{fullTitle(item.source)}</div>
                        <div className="track-artists">
                          {item.source.artists.join(", ")} ·{" "}
                          <span className="duration">{duration(item.source.durationMs)}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {item.match && effectiveStatus(item) !== "notFound" ? (
                      <div className="track-cell">
                        {showDirection && <span className="service-dot" data-service={item.to} />}
                        <div>
                          <div className="track-title">{fullTitle(item.match)}</div>
                          <div className="track-artists">
                            {item.match.artists.join(", ")} ·{" "}
                            <span className="duration">{duration(item.match.durationMs)}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <span className="track-artists">-</span>
                    )}
                  </td>
                  <td>
                    <StatusLabel item={item} />
                  </td>
                  <td>
                    {(item.status === "review" || item.status === "notFound") && (item.candidates?.length ?? 0) > 0 && (
                      <button type="button" className="button button-small" onClick={() => onReview(item.id)}>
                        {t("table.choose")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {visible.length > LIMIT && (
          <p className="table-empty">{t("table.limited", { shown: LIMIT, total: visible.length })}</p>
        )}
      </div>
    </>
  );
}
