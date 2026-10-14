import { chmod, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const appDataDir = join(homedir(), ".music-freedom");
const tokensFile = join(appDataDir, "tokens.json");

export type StoredTokens = {
  yandex?: { accessToken: string };
  spotify?: { clientId: string; accessToken: string; refreshToken: string; expiresAt: number; scope?: string };
};

export async function loadTokens(): Promise<StoredTokens> {
  const file = Bun.file(tokensFile);
  if (!(await file.exists())) return {};
  try {
    return (await file.json()) as StoredTokens;
  } catch {
    // Повреждённый файл не должен ронять программу при каждом запуске: просто войдём заново.
    return {};
  }
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await mkdir(appDataDir, { recursive: true, mode: 0o700 });
  // Атомарно: временный файл и переименование, чтобы обрыв записи не оставил обрезанный JSON.
  const temporary = `${tokensFile}.tmp`;
  await Bun.write(temporary, JSON.stringify(tokens, null, 2));
  await chmod(temporary, 0o600);
  await rename(temporary, tokensFile);
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Изменение файла токенов по очереди: чтение и запись из разных мест (обновление токена,
 * отключение, вход) не должны затирать друг друга.
 */
export function updateTokens(change: (tokens: StoredTokens) => void): Promise<StoredTokens> {
  const run = queue.then(async () => {
    const tokens = await loadTokens();
    change(tokens);
    await saveTokens(tokens);
    return tokens;
  });
  queue = run.catch(() => {});
  return run;
}
