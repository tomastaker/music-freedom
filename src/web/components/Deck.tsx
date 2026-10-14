import type { ServiceId, ServiceState } from "../../shared/api";
import { t } from "../i18n";
import { Counter } from "./Counter";
import { Reel } from "./Reel";

type Props = {
  service: ServiceId;
  state: ServiceState;
  role: "source" | "target" | "both";
  /** Буква деки на панели: А слева, Б справа. */
  letter: string;
  /** Доля ленты на подающей катушке: размер этой библиотеки относительно большей из двух. */
  pack: number;
  running: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
};

export function Deck({ service, state, role, letter, pack, running, onConnect, onDisconnect, onRetry }: Props) {
  const connected = state.status === "connected";
  const likes = connected ? state.likes : null;
  const error = state.status !== "connecting" ? state.error : undefined;
  return (
    <section
      className={`deck${running ? " is-running" : ""}`}
      data-state={state.status}
      aria-label={`${t(`service.${service}`)}, ${t(`deck.${role}`)}`}
    >
      <div className="deck-head">
        <h2 className="deck-name">
          <span className="service-dot" data-service={service} />
          {t(`service.${service}`)}
        </h2>
        <span className="deck-account">
          {state.status === "connected"
            ? state.account || " "
            : state.status === "connecting"
              ? t("service.connecting")
              : t("service.notConnected")}
        </span>
      </div>
      <div className="deck-counter">
        <Counter value={likes} label={likes === null ? undefined : `${likes} ${t("service.likes")}`} />
        <span className="deck-counter-label">{t("service.likes")}</span>
      </div>
      <div className="tape-window">
        <Reel pack={connected ? pack : 0} />
        <span className="tape-strip" />
        <Reel pack={connected ? (1 - pack) * 0.4 : 0} />
      </div>
      {error && (
        <p className="deck-error" role="alert">
          {error}
        </p>
      )}
      <div className="deck-foot">
        <span className="deck-plate" aria-hidden="true">
          {t("deck.plate", { letter, role: t(`deck.${role}`) })}
        </span>
        <span className="deck-actions">
          {connected && error && (
            <button type="button" className="deck-link" onClick={onRetry}>
              {t("service.retry")}
            </button>
          )}
          {connected ? (
            <button type="button" className="deck-link" onClick={onDisconnect}>
              {t("service.disconnect")}
            </button>
          ) : state.status === "disconnected" ? (
            <button type="button" className="deck-link" onClick={onConnect}>
              {t("service.connect")}
            </button>
          ) : null}
        </span>
      </div>
    </section>
  );
}
