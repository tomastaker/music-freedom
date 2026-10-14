import { buildPlan, type Direction, decide, type Plan, summarize, tracksToAdd } from "../core/plan";
import type { MusicService } from "../core/service";
import type { ServiceId, Track } from "../core/track";
import { loadTokens, updateTokens } from "../lib/token-store";
import {
  createPkceRequest,
  exchangeCode,
  type PkceRequest,
  REDIRECT_URI_TO_REGISTER,
  refreshTokens,
  SpotifyClient,
  SpotifyService,
} from "../providers/spotify/client";
import { requestDeviceCode, waitForDeviceToken, YandexService } from "../providers/yandex/client";
import type { AppState, JobState, LastRun, ServiceState, TransferMode } from "../shared/api";
import type { Store } from "./db";
import { isAuthError, userMessage } from "./errors";

const SPOTIFY_SCOPES = ["user-library-read", "user-library-modify"];

const DIRECTIONS: Record<TransferMode, Direction[]> = {
  "yandex-spotify": [{ from: "yandex", to: "spotify" }],
  "spotify-yandex": [{ from: "spotify", to: "yandex" }],
  both: [
    { from: "yandex", to: "spotify" },
    { from: "spotify", to: "yandex" },
  ],
};

export class App {
  private readonly services: Partial<Record<ServiceId, MusicService>> = {};
  private serviceState: Record<ServiceId, ServiceState> = {
    yandex: { status: "disconnected" },
    spotify: { status: "disconnected" },
  };
  private yandexCode: AppState["services"]["yandex"]["pendingCode"];
  private yandexLogin: AbortController | null = null;
  private pendingYandexToken: string | undefined;
  private spotifyClientId: string | undefined;
  private spotifyLogin: PkceRequest | null = null;
  private job: JobState | null = null;
  private jobAbort: AbortController | null = null;
  private jobError: string | null = null;
  private plan: { mode: TransferMode; version: number; data: Plan } | null = null;
  private lastRun: LastRun | null = null;

  constructor(private readonly store: Store) {}

  /** Демо-режим: готовые сервисы вместо входа в настоящие аккаунты. */
  async startDemo(services: Record<ServiceId, MusicService>): Promise<void> {
    Object.assign(this.services, services);
    await Promise.all((["yandex", "spotify"] as const).map((id) => this.refreshOverview(id)));
  }

  async start(): Promise<void> {
    const tokens = await loadTokens();
    this.spotifyClientId = tokens.spotify?.clientId;
    const work: Promise<void>[] = [];
    if (tokens.yandex) work.push(this.connectYandex(tokens.yandex.accessToken));
    if (tokens.spotify?.refreshToken) {
      const scopes = tokens.spotify.scope?.split(" ") ?? [];
      if (SPOTIFY_SCOPES.every((scope) => scopes.includes(scope))) work.push(this.connectSpotify());
      else
        this.serviceState.spotify = {
          status: "disconnected",
          error: "Войдите в Spotify ещё раз: программе нужно право добавлять треки.",
        };
    }
    await Promise.all(work);
  }

  state(): AppState {
    return {
      services: {
        yandex: { ...this.serviceState.yandex, pendingCode: this.yandexCode },
        spotify: {
          ...this.serviceState.spotify,
          clientId: this.spotifyClientId,
          redirectUri: REDIRECT_URI_TO_REGISTER,
        },
      },
      job: this.job,
      jobError: this.jobError,
      plan: this.plan && {
        mode: this.plan.mode,
        version: this.plan.version,
        summary: summarize(this.plan.data),
        limitedUntil: Math.max(0, ...Object.values(this.plan.data.limitedUntil)) || null,
      },
      lastRun: this.lastRun,
    };
  }

  planItems() {
    return this.plan?.data.items ?? [];
  }

  // --- Подключение сервисов ---

  private async refreshOverview(id: ServiceId): Promise<void> {
    const service = this.services[id];
    if (!service) return;
    try {
      const { account, likes } = await service.overview();
      this.serviceState[id] = { status: "connected", account, likes };
    } catch (error) {
      if (isAuthError(error)) {
        delete this.services[id];
        this.serviceState[id] = { status: "disconnected", error: userMessage(error, id) };
        return;
      }
      // Сеть, VPN, сбой сервиса: вход действителен, достаточно повторить.
      const previous = this.serviceState[id];
      const account = previous.status === "connected" ? previous.account : "";
      this.serviceState[id] = { status: "connected", account, likes: null, error: userMessage(error, id) };
    }
  }

  async retry(id: ServiceId): Promise<void> {
    if (this.job) throw new Error("Дождитесь окончания текущей операции");
    if (id === "yandex" && !this.services.yandex && this.pendingYandexToken) {
      await this.connectYandex(this.pendingYandexToken);
      return;
    }
    await this.refreshOverview(id);
  }

  private async connectYandex(token: string): Promise<void> {
    this.serviceState.yandex = { status: "connecting" };
    try {
      this.services.yandex = await YandexService.connect(token);
      this.pendingYandexToken = undefined;
      await this.refreshOverview("yandex");
    } catch (error) {
      delete this.services.yandex;
      if (isAuthError(error)) {
        this.serviceState.yandex = { status: "disconnected", error: userMessage(error, "yandex") };
      } else {
        // Токен цел, но Яндекс недоступен: запоминаем токен для повтора.
        this.pendingYandexToken = token;
        this.serviceState.yandex = {
          status: "connected",
          account: "",
          likes: null,
          error: userMessage(error, "yandex"),
        };
      }
    }
  }

  async startYandexLogin(): Promise<void> {
    this.yandexLogin?.abort();
    const abort = new AbortController();
    this.yandexLogin = abort;
    const code = await requestDeviceCode();
    this.yandexCode = {
      userCode: code.userCode,
      verificationUrl: code.verificationUrl,
      expiresAt: Date.now() + code.expiresInSec * 1000,
    };
    waitForDeviceToken(code, abort.signal)
      .then(async (token) => {
        // Пользователь нажал «Отмена», пока ответ с токеном был в пути: вход не принимаем.
        if (abort.signal.aborted) return;
        await updateTokens((tokens) => {
          tokens.yandex = { accessToken: token };
        });
        this.yandexCode = undefined;
        await this.connectYandex(token);
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        this.yandexCode = undefined;
        this.serviceState.yandex = { status: "disconnected", error: userMessage(error, "yandex") };
      });
  }

  cancelYandexLogin(): void {
    this.yandexLogin?.abort();
    this.yandexCode = undefined;
  }

  async setSpotifyClientId(clientId: string): Promise<void> {
    if (!/^[0-9a-f]{32}$/i.test(clientId)) {
      throw new Error("Client ID выглядит иначе: это 32 символа из цифр и букв a–f со страницы приложения.");
    }
    if (this.job) throw new Error("Дождитесь окончания текущей операции");
    this.spotifyClientId = clientId;
    await updateTokens((tokens) => {
      tokens.spotify = { clientId, accessToken: "", refreshToken: "", expiresAt: 0 };
    });
    delete this.services.spotify;
    this.serviceState.spotify = { status: "disconnected" };
    this.plan = null;
  }

  async spotifyAuthUrl(): Promise<string> {
    if (!this.spotifyClientId) throw new Error("Сначала укажите Client ID");
    this.spotifyLogin = await createPkceRequest(this.spotifyClientId, SPOTIFY_SCOPES);
    return this.spotifyLogin.authUrl;
  }

  async finishSpotifyLogin(params: URLSearchParams): Promise<void> {
    const login = this.spotifyLogin;
    // Чужой запрос без нашего state не должен сбрасывать начатый вход.
    if (!login || !this.spotifyClientId || params.get("state") !== login.state) {
      throw new Error("Ссылка входа устарела. Нажмите «Войти через Spotify» ещё раз.");
    }
    this.spotifyLogin = null;
    const error = params.get("error");
    if (error === "access_denied") throw new Error("Вы отменили вход в Spotify.");
    if (error) throw new Error(`Spotify не пустил: ${error}`);
    const clientId = this.spotifyClientId;
    const tokens = await exchangeCode(clientId, params.get("code") ?? "", login.verifier);
    const granted = tokens.scope?.split(" ") ?? [];
    if (!SPOTIFY_SCOPES.every((scope) => granted.includes(scope))) {
      throw new Error("Spotify не выдал право добавлять треки. Войдите ещё раз и разрешите доступ.");
    }
    await updateTokens((saved) => {
      saved.spotify = { clientId, ...tokens };
    });
    await this.connectSpotify();
  }

  private async connectSpotify(): Promise<void> {
    this.serviceState.spotify = { status: "connecting" };
    // Обновление токена одно на всех: параллельные запросы ждут его, а не обновляют каждый сам.
    let refreshing: Promise<string> | null = null;
    const getToken = async () => {
      const saved = (await loadTokens()).spotify;
      if (!saved?.refreshToken) throw new Error("Spotify не подключён");
      if (saved.expiresAt > Date.now()) return saved.accessToken;
      refreshing ??= (async () => {
        // Перечитываем: пока этот вызов ждал, другой мог уже обновить токен.
        const current = (await loadTokens()).spotify;
        if (!current?.refreshToken) throw new Error("Spotify не подключён");
        if (current.expiresAt > Date.now()) return current.accessToken;
        const fresh = { clientId: current.clientId, ...(await refreshTokens(current.clientId, current)) };
        await updateTokens((tokens) => {
          // Если за это время Spotify отключили или вошли заново, старый вход не возвращаем.
          if (tokens.spotify?.refreshToken === current.refreshToken) tokens.spotify = fresh;
        });
        return fresh.accessToken;
      })().finally(() => {
        refreshing = null;
      });
      return refreshing;
    };
    this.services.spotify = new SpotifyService(new SpotifyClient(getToken));
    await this.refreshOverview("spotify");
  }

  async disconnect(id: ServiceId): Promise<void> {
    if (this.job) throw new Error("Дождитесь окончания текущей операции");
    await updateTokens((tokens) => {
      if (id === "yandex") delete tokens.yandex;
      // Client ID оставляем: это настройка приложения пользователя, а не вход.
      if (id === "spotify" && tokens.spotify) tokens.spotify = { ...tokens.spotify, accessToken: "", refreshToken: "" };
    });
    if (id === "yandex") this.pendingYandexToken = undefined;
    delete this.services[id];
    this.serviceState[id] = { status: "disconnected" };
    this.plan = null;
  }

  // --- Сравнение, запись, отмена ---

  private runJob(kind: JobState["kind"], work: (signal: AbortSignal) => Promise<void>): void {
    if (this.job) throw new Error("Уже идёт другая операция");
    const abort = new AbortController();
    this.jobAbort = abort;
    this.jobError = null;
    this.job = { kind, stage: kind === "undo" ? "undo" : "match", done: 0, total: 0 };
    work(abort.signal)
      .catch((error) => {
        this.jobError = userMessage(error);
      })
      .finally(() => {
        this.job = null;
        this.jobAbort = null;
      });
  }

  private progress(stage: JobState["stage"], done: number, total: number): void {
    if (this.job) this.job = { ...this.job, stage, done, total };
  }

  cancelJob(): void {
    this.jobAbort?.abort();
  }

  dismissError(): void {
    this.jobError = null;
  }

  startPlan(mode: TransferMode): void {
    const directions = DIRECTIONS[mode];
    for (const id of new Set(directions.flatMap((d) => [d.from, d.to]))) {
      if (!this.services[id]) throw new Error("Сначала подключите оба сервиса");
    }
    this.runJob("plan", async (signal) => {
      const data = await buildPlan({
        services: this.services,
        directions,
        cache: this.store,
        signal,
        onProgress: (p) =>
          p.phase === "load"
            ? this.progress(`load-${p.service}` as const, p.loaded, p.total)
            : this.progress("match", p.done, p.total),
      });
      this.plan = { mode, version: (this.plan?.version ?? 0) + 1, data };
      for (const [id, likes] of Object.entries(data.libraries)) {
        const state = this.serviceState[id as ServiceId];
        if (state.status === "connected") state.likes = likes;
      }
    });
  }

  decide(itemId: string, choice: { trackId: string } | "skip"): void {
    if (!this.plan) throw new Error("Сначала сравните библиотеки");
    if (this.job) throw new Error("Дождитесь окончания текущей операции");
    const item = decide(this.plan.data, itemId, choice);
    if (item.decision === "accepted" && item.match) {
      this.store.set(item.from, item.source.id, item.to, { target: item.match, level: "high" });
    }
    this.plan.version++;
  }

  startApply(): void {
    const plan = this.plan;
    if (!plan) throw new Error("Сначала сравните библиотеки");
    this.runJob("apply", async (signal) => {
      const runId = this.store.startRun();
      const added: LastRun["added"] = {};
      try {
        for (const { to, items: planned } of tracksToAdd(plan.data)) {
          const service = this.services[to];
          if (!service || planned.length === 0) continue;
          // Свежая сверка перед записью: трек, лайкнутый после сравнения, не должен попасть в журнал,
          // иначе отмена снимет лайк, который пользователь ставил сам.
          this.progress(`load-${to}`, 0, 0);
          const liked = new Set((await service.likedTracks()).map((t) => t.id));
          signal.throwIfAborted();
          const items = planned.filter((i) => !liked.has(i.match?.id ?? ""));
          for (const item of planned) {
            // Уже в избранном к моменту записи: показываем как «уже есть», а не «добавится».
            if (liked.has(item.match?.id ?? "")) {
              item.status = "exists";
              item.decision = undefined;
            }
          }
          // Снимок: решения, принятые во время записи, не меняют то, что пишется и попадает в журнал.
          const tracks = items.map((i) => i.match as Track);
          this.progress(`write-${to}`, 0, tracks.length);
          await service.addLikes(tracks, (done) => {
            const track = tracks[done - 1];
            const item = items[done - 1];
            if (track) this.store.recordAdded(runId, to, track);
            if (item) {
              item.status = "exists";
              item.decision = undefined;
              item.added = true;
            }
            added[to] = done;
            this.progress(`write-${to}`, done, tracks.length);
            // Проверка после записи в журнал: уже добавленный трек должен остаться отменяемым.
            signal.throwIfAborted();
          });
        }
      } finally {
        // Даже после остановки или ошибки отмена должна знать, что уже записано.
        this.lastRun = { id: runId, added, undone: false };
        plan.version++;
        await Promise.all((Object.keys(added) as ServiceId[]).map((id) => this.refreshOverview(id)));
      }
    });
  }

  startUndo(runId: number): void {
    const run = this.store.runs().find((r) => r.id === runId);
    if (!run) throw new Error("Такого переноса нет");
    if (run.undoneAt) throw new Error("Этот перенос уже отменён");
    this.runJob("undo", async () => {
      const items = this.store.runTracks(runId);
      this.progress("undo", 0, items.length);
      for (const id of ["yandex", "spotify"] as const) {
        const tracks = items.filter((i) => i.service === id).map((i) => i.track);
        if (tracks.length === 0) continue;
        const service = this.services[id];
        if (!service) throw new Error("Подключите сервис, чтобы отменить перенос в него");
        await service.removeLikes(tracks);
      }
      this.store.markUndone(runId);
      if (this.lastRun?.id === runId) this.lastRun = { ...this.lastRun, undone: true };
      this.plan = null;
      this.progress("undo", items.length, items.length);
      await Promise.all((["yandex", "spotify"] as const).map((id) => this.refreshOverview(id)));
    });
  }

  runs() {
    return this.store.runs();
  }
}
