import type { ServiceId, Track } from "./track";

/** Музыкальный сервис глазами переноса. Новый сервис (Apple Music, Deezer) реализует этот интерфейс. */
export interface MusicService {
  readonly id: ServiceId;
  /** Имя аккаунта и размер избранного: быстро, без загрузки всех треков. */
  overview(): Promise<{ account: string; likes: number }>;
  /** Избранные треки, от новых к старым. */
  likedTracks(onProgress?: (loaded: number, total: number) => void): Promise<Track[]>;
  /** Кандидаты из каталога сервиса для трека из другого сервиса. */
  findCandidates(source: Track): Promise<Track[]>;
  /** Добавляет треки в избранное в переданном порядке: первый станет самым старым. */
  addLikes(tracks: Track[], onProgress?: (done: number) => void): Promise<void>;
  removeLikes(tracks: Track[]): Promise<void>;
}
