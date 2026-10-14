export type ServiceId = "yandex" | "spotify";

export type Track = {
  service: ServiceId;
  id: string;
  title: string;
  /** Уточнение версии: «Remastered 2011», «Live» и т.п. У Яндекса хранится отдельно от названия. */
  version?: string;
  artists: string[];
  album?: string;
  durationMs: number;
  isrc?: string;
  /** Альбом в сервисе: Яндексу он нужен, чтобы поставить лайк конкретному изданию трека. */
  albumId?: string;
};
