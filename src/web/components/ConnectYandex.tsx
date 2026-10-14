import { ArrowSquareOut } from "@phosphor-icons/react";
import { useState } from "react";
import type { YandexState } from "../../shared/api";
import { api } from "../api";
import { t } from "../i18n";
import { Reel } from "./Reel";

export function ConnectYandex({ state, onChange }: { state: YandexState; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = state.pendingCode;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/yandex/login");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const cancel = async () => {
    await api.post("/api/yandex/login/cancel");
    onChange();
  };

  const minutes = code ? Math.max(1, Math.round((code.expiresAt - Date.now()) / 60000)) : 0;

  return (
    <div className="connect">
      <h2>
        <span className="service-dot" data-service="yandex" />
        {t("yandexConnect.title")}
      </h2>
      {code ? (
        <div className="device-code">
          <p>{t("yandexConnect.enterCode")}</p>
          {/* Код из букв: показываем как есть, без барабана цифр. */}
          <span className="counter">{code.userCode}</span>
          <div className="inline-actions">
            <a className="button button-primary" href={code.verificationUrl} target="_blank" rel="noreferrer">
              <ArrowSquareOut weight="bold" />
              {t("yandexConnect.openSite")}
            </a>
            <button type="button" className="button button-quiet" onClick={cancel}>
              {t("yandexConnect.cancel")}
            </button>
          </div>
          <p className="waiting" aria-live="polite">
            <Reel />
            {t("yandexConnect.waiting")} · {t("yandexConnect.expires", { min: minutes })}
          </p>
        </div>
      ) : (
        <>
          <p className="connect-lead">{t("yandexConnect.text")}</p>
          <div>
            <button type="button" className="button button-primary" disabled={busy} onClick={start}>
              {t("yandexConnect.getCode")}
            </button>
          </div>
        </>
      )}
      {(error ?? (state.status === "disconnected" ? state.error : undefined)) && (
        <p className="field-error" role="alert">
          {error ?? (state.status === "disconnected" ? state.error : "")}
        </p>
      )}
    </div>
  );
}
