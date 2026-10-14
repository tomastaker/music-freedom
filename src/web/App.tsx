import { ArrowCounterClockwise, CheckCircle, DownloadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { AppState, PlanItem, ServiceId, ServiceState, TransferMode } from "../shared/api";
import { api, useAppState, usePlanItems } from "./api";
import { ConnectSpotify } from "./components/ConnectSpotify";
import { ConnectYandex } from "./components/ConnectYandex";
import { Deck } from "./components/Deck";
import { fullTitle } from "./components/format";
import { addedText, History } from "./components/History";
import { type Filter, Meters } from "./components/Meters";
import { Reel } from "./components/Reel";
import { Review } from "./components/Review";
import { TrackTable } from "./components/TrackTable";
import { Transport } from "./components/Transport";
import { formatNumber, t, tracks } from "./i18n";

type Tab = "transfer" | "history";

const errorOf = (state: ServiceState) => (state.status === "connecting" ? undefined : state.error);

function roleOf(service: ServiceId, mode: TransferMode): "source" | "target" | "both" {
  if (mode === "both") return "both";
  return mode.startsWith(service) ? "source" : "target";
}

function deckRunning(service: ServiceId, job: AppState["job"]): boolean {
  if (!job) return false;
  return job.stage === "match" || job.stage === "undo" || job.stage.endsWith(service);
}

function downloadNotFound(items: PlanItem[]) {
  const lines = items
    .filter((i) => !i.unchecked)
    .filter((i) => (i.status === "notFound" && i.decision !== "accepted") || i.decision === "skipped")
    .map((i) => `${i.source.artists.join(", ")} - ${fullTitle(i.source)}`);
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "music-freedom-не-найдено.txt";
  link.click();
  URL.revokeObjectURL(link.href);
}

function Banner({
  tone,
  children,
  onClose,
}: {
  tone: "error" | "ok";
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="banner" data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      {tone === "error" ? <WarningCircle weight="fill" /> : <CheckCircle weight="fill" />}
      <div className="banner-text">{children}</div>
      {onClose && (
        <button type="button" className="button button-quiet" onClick={onClose} aria-label={t("error.dismiss")}>
          <X weight="bold" />
        </button>
      )}
    </div>
  );
}

export function App() {
  const { state, offline, refresh } = useAppState();
  const items = usePlanItems(state?.plan?.version);
  const [tab, setTab] = useState<Tab>("transfer");
  const [mode, setMode] = useState<TransferMode>("yandex-spotify");
  const [filter, setFilter] = useState<Filter>("all");
  const [review, setReview] = useState<{ startId?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const workspace = useRef<HTMLElement>(null);

  // Ошибку входа в Spotify сервер передаёт через адрес после возврата из Spotify.
  useEffect(() => {
    const error = new URLSearchParams(location.search).get("error");
    if (error) {
      setActionError(error);
      history.replaceState(null, "", "/");
    }
  }, []);

  const planMode = state?.plan?.mode;
  useEffect(() => {
    if (planMode) setMode(planMode);
  }, [planMode]);

  const act = async (path: string, body?: unknown) => {
    setActionError(null);
    try {
      await api.post(path, body);
    } catch (e) {
      setActionError((e as Error).message);
    }
    refresh();
  };

  if (!state) {
    return (
      <main className="shell">
        <p className="empty">{offline ? t("error.network") : ""}</p>
      </main>
    );
  }

  const { yandex, spotify } = state.services;
  const connectedBoth = yandex.status === "connected" && spotify.status === "connected";
  const ready = connectedBoth && !yandex.error && !spotify.error;
  const job = state.job;
  const compared = Boolean(state.plan && state.plan.mode === mode);
  const summary = compared ? (state.plan?.summary ?? null) : null;
  const disconnected = (["yandex", "spotify"] as const).filter((id) => state.services[id].status !== "connected");
  const lastRun = state.lastRun;
  const likesOf = (s: ServiceState) => (s.status === "connected" ? (s.likes ?? 0) : 0);
  const biggest = Math.max(1, likesOf(yandex), likesOf(spotify));

  const focusWorkspace = () => {
    setTab("transfer");
    workspace.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const undo = (runId: number) => {
    if (confirm(t("report.confirmUndo"))) act(`/api/runs/${runId}/undo`);
  };

  let content: React.ReactNode;
  if (tab === "history") {
    content = <History busy={Boolean(job)} onUndo={undo} />;
  } else if (job) {
    const share = job.total > 0 ? job.done / job.total : 0;
    content = (
      <div className="progress" aria-live="polite">
        <span className="progress-title">{t(`job.${job.stage}`)}</span>
        <div className="progress-track">
          <div className="progress-fill" style={{ transform: `scaleX(${share})` }} />
        </div>
        <span className="progress-meta">
          {job.total > 0 ? t("job.of", { done: formatNumber(job.done), total: formatNumber(job.total) }) : "…"}
        </span>
      </div>
    );
  } else if (disconnected.length > 0) {
    content = (
      <div className={disconnected.length === 2 ? "connect-grid" : undefined}>
        {disconnected.includes("yandex") && <ConnectYandex state={yandex} onChange={refresh} />}
        {disconnected.includes("spotify") && <ConnectSpotify state={spotify} onChange={refresh} />}
      </div>
    );
  } else if (review && compared) {
    content = <Review items={items} startId={review.startId} onClose={() => setReview(null)} onDecided={refresh} />;
  } else if (compared) {
    content = (
      <TrackTable
        items={items}
        filter={filter}
        onFilter={setFilter}
        showDirection={mode === "both"}
        onReview={(startId) => setReview({ startId })}
      />
    );
  } else if (!ready) {
    content = (
      <div className="empty">
        <h2>{t("empty.blockedTitle")}</h2>
        <p>{errorOf(yandex) ?? errorOf(spotify)}</p>
      </div>
    );
  } else {
    content = (
      <div className="empty">
        <h2>{t("empty.compareTitle")}</h2>
        <p>{t("empty.compareText")}</p>
      </div>
    );
  }

  const added = lastRun ? addedText(lastRun.added) : "";

  return (
    <main className="shell">
      <header className="topbar">
        <span className="brand">
          <Reel className="brand-mark" pack={0.7} />
          {t("app.title")}
        </span>
        <div className="tabs" role="tablist">
          {(["transfer", "history"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {t(value === "transfer" ? "app.tabTransfer" : "app.tabHistory")}
            </button>
          ))}
        </div>
      </header>

      <div className="console">
        <Deck
          service="yandex"
          state={yandex}
          role={roleOf("yandex", mode)}
          letter="А"
          pack={likesOf(yandex) / biggest}
          running={deckRunning("yandex", job)}
          onConnect={focusWorkspace}
          onDisconnect={() => act("/api/services/yandex/disconnect")}
          onRetry={() => act("/api/services/yandex/retry")}
        />
        <Transport
          mode={mode}
          onMode={(next) => {
            setMode(next);
            setFilter("all");
            setReview(null);
          }}
          ready={ready}
          blocked={connectedBoth && !ready}
          running={Boolean(job)}
          compared={compared}
          toAdd={summary?.add ?? 0}
          toReview={summary?.review ?? 0}
          onCompare={() => {
            setReview(null);
            setFilter("all");
            act("/api/plan", { mode });
          }}
          onRecord={() => act("/api/apply")}
          onStop={() => act("/api/job/cancel")}
        />
        <Deck
          service="spotify"
          state={spotify}
          role={roleOf("spotify", mode)}
          letter="Б"
          pack={likesOf(spotify) / biggest}
          running={deckRunning("spotify", job)}
          onConnect={focusWorkspace}
          onDisconnect={() => act("/api/services/spotify/disconnect")}
          onRetry={() => act("/api/services/spotify/retry")}
        />
      </div>

      <Meters summary={summary} filter={filter} onFilter={setFilter} />

      <section className="workspace" ref={workspace} aria-label={t("app.tabTransfer")}>
        {offline && <Banner tone="error">{t("error.network")}</Banner>}
        {(actionError ?? state.jobError) && (
          <Banner
            tone="error"
            onClose={() => {
              setActionError(null);
              if (state.jobError) act("/api/job/dismiss-error");
            }}
          >
            {actionError ?? state.jobError}
          </Banner>
        )}
        {compared && state.plan?.limitedUntil && (summary?.unchecked ?? 0) > 0 && !job && tab === "transfer" && (
          <Banner tone="error">
            {t("limited.text", {
              until: new Date(state.plan.limitedUntil).toLocaleString("ru-RU", {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
              count: tracks(summary?.unchecked ?? 0),
            })}
          </Banner>
        )}
        {lastRun && !job && tab === "transfer" && (
          <Banner tone="ok">
            <div className="inline-actions">
              <span>
                {lastRun.undone ? t("report.undone") : added ? t("report.added", { list: added }) : t("report.nothing")}
              </span>
              {!lastRun.undone && added && (
                <button type="button" className="button" onClick={() => undo(lastRun.id)}>
                  <ArrowCounterClockwise weight="bold" />
                  {t("report.undo")}
                </button>
              )}
              {compared && (summary?.notFound ?? 0) > 0 && (
                <button type="button" className="button button-quiet" onClick={() => downloadNotFound(items)}>
                  <DownloadSimple weight="bold" />
                  {t("report.notFoundList")}
                </button>
              )}
            </div>
          </Banner>
        )}
        {content}
      </section>

      <p className="footer">{t("app.footer")}</p>
    </main>
  );
}
