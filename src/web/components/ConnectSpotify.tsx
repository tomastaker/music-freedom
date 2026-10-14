import { ArrowSquareOut, Check, Copy, SignIn } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import type { ErrorInfo, SpotifyState } from "../../shared/api";
import { api, toInfo } from "../api";
import { errorText, t } from "../i18n";

export function ConnectSpotify({ state, onChange }: { state: SpotifyState; onChange: () => void }) {
  const [editing, setEditing] = useState(!state.clientId);
  const [clientId, setClientId] = useState(state.clientId ?? "");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(state.redirectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/api/spotify/client-id", { clientId });
      setEditing(false);
      onChange();
    } catch (e) {
      setError(toInfo(e));
    }
  };

  const serviceError = state.status === "disconnected" ? state.error : undefined;

  return (
    <div className="connect">
      <h2>
        <span className="service-dot" data-service="spotify" />
        {t("spotifyConnect.title")}
      </h2>
      <p className="connect-lead">{t("spotifyConnect.premium")}</p>
      {editing ? (
        <ol className="steps">
          <li>
            <div className="step-body">
              <span>{t("spotifyConnect.step1")}</span>
              <a className="button" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
                <ArrowSquareOut weight="bold" />
                {t("spotifyConnect.openDashboard")}
              </a>
            </div>
          </li>
          <li>
            <div className="step-body">
              <span>{t("spotifyConnect.step2")}</span>
              <div className="code-field">
                <code>{state.redirectUri}</code>
                <button type="button" className="button" onClick={copy}>
                  {copied ? <Check weight="bold" /> : <Copy weight="bold" />}
                  {copied ? t("spotifyConnect.copied") : t("spotifyConnect.copy")}
                </button>
              </div>
            </div>
          </li>
          <li>
            <div className="step-body">
              <span>{t("spotifyConnect.step3")}</span>
            </div>
          </li>
          <li>
            <form className="step-body" onSubmit={save}>
              <span>{t("spotifyConnect.step4")}</span>
              <div className="field">
                <label htmlFor="client-id">{t("spotifyConnect.clientIdLabel")}</label>
                <div className="field-row">
                  <input
                    id="client-id"
                    className="input"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder={t("spotifyConnect.clientIdPlaceholder")}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "client-id-error" : undefined}
                  />
                  <button type="submit" className="button button-primary" disabled={!clientId.trim()}>
                    {t("spotifyConnect.save")}
                  </button>
                </div>
                {error && (
                  <p id="client-id-error" className="field-error" role="alert">
                    {errorText(error)}
                  </p>
                )}
              </div>
            </form>
          </li>
        </ol>
      ) : (
        <div className="step-body">
          <div className="inline-actions">
            <span className="muted">{t("spotifyConnect.clientIdSaved", { id: shortId(state.clientId ?? "") })}</span>
            <button type="button" className="button button-quiet" onClick={() => setEditing(true)}>
              {t("spotifyConnect.change")}
            </button>
          </div>
          <a className="button button-primary" href="/api/spotify/login">
            <SignIn weight="bold" />
            {t("spotifyConnect.login")}
          </a>
        </div>
      )}
      {serviceError && (
        <p className="field-error" role="alert">
          {errorText(serviceError)}
        </p>
      )}
    </div>
  );
}

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
