import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CachedMatch, MatchCache } from "../core/plan";
import type { ServiceId, Track } from "../core/track";
import { appDataDir } from "../lib/token-store";

/** «Не найдено» перепроверяется через неделю: каталоги пополняются. */
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type RunRecord = {
  id: number;
  createdAt: number;
  undoneAt: number | null;
  added: Partial<Record<ServiceId, number>>;
};

export class Store implements MatchCache {
  private readonly db: Database;

  constructor(path = join(appDataDir, "data.sqlite")) {
    mkdirSync(appDataDir, { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    // Состав библиотеки и история переносов личные: доступ только у владельца, как у токенов.
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`CREATE TABLE IF NOT EXISTS matches (
      from_service TEXT NOT NULL, source_id TEXT NOT NULL, to_service TEXT NOT NULL,
      value TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (from_service, source_id, to_service))`);
    this.db.run(`CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, undone_at INTEGER)`);
    this.db.run(`CREATE TABLE IF NOT EXISTS run_items (
      run_id INTEGER NOT NULL REFERENCES runs(id), service TEXT NOT NULL, track TEXT NOT NULL)`);
  }

  get(from: ServiceId, sourceId: string, to: ServiceId): CachedMatch | undefined {
    const row = this.db
      .query<{ value: string; updated_at: number }, [string, string, string]>(
        "SELECT value, updated_at FROM matches WHERE from_service = ? AND source_id = ? AND to_service = ?",
      )
      .get(from, sourceId, to);
    if (!row) return undefined;
    const value = JSON.parse(row.value) as CachedMatch;
    if (!value.target && Date.now() - row.updated_at > NOT_FOUND_TTL_MS) return undefined;
    return value;
  }

  set(from: ServiceId, sourceId: string, to: ServiceId, value: CachedMatch): void {
    this.db
      .query("INSERT OR REPLACE INTO matches VALUES (?, ?, ?, ?, ?)")
      .run(from, sourceId, to, JSON.stringify(value), Date.now());
  }

  startRun(): number {
    return Number(this.db.query("INSERT INTO runs (created_at) VALUES (?)").run(Date.now()).lastInsertRowid);
  }

  recordAdded(runId: number, service: ServiceId, track: Track): void {
    this.db.query("INSERT INTO run_items VALUES (?, ?, ?)").run(runId, service, JSON.stringify(track));
  }

  runs(): RunRecord[] {
    const rows = this.db
      .query<{ id: number; created_at: number; undone_at: number | null; service: string | null; n: number }, []>(
        `SELECT r.id, r.created_at, r.undone_at, i.service, COUNT(i.track) AS n
         FROM runs r LEFT JOIN run_items i ON i.run_id = r.id
         GROUP BY r.id, i.service ORDER BY r.id DESC`,
      )
      .all();
    const byId = new Map<number, RunRecord>();
    for (const row of rows) {
      const run = byId.get(row.id) ?? { id: row.id, createdAt: row.created_at, undoneAt: row.undone_at, added: {} };
      if (row.service) run.added[row.service as ServiceId] = row.n;
      byId.set(row.id, run);
    }
    return [...byId.values()].filter((run) => Object.keys(run.added).length > 0);
  }

  runTracks(runId: number): { service: ServiceId; track: Track }[] {
    return this.db
      .query<{ service: string; track: string }, [number]>("SELECT service, track FROM run_items WHERE run_id = ?")
      .all(runId)
      .map((row) => ({ service: row.service as ServiceId, track: JSON.parse(row.track) as Track }));
  }

  markUndone(runId: number): void {
    this.db.query("UPDATE runs SET undone_at = ? WHERE id = ?").run(Date.now(), runId);
  }
}
