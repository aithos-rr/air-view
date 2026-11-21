import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Beside the cache the builder writes, so one `rm -rf server/data` clears both. */
export const DEFAULT_LOCK_PATH = 'server/data/.build-routes.lock';
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

/** The slice of node:fs this module uses, so a test can hand it a Map. */
export interface LockFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
  mkdirSync(path: string, options: { recursive: true }): void;
  rmSync(path: string, options: { force: true }): void;
}

export interface ProviderLockDeps {
  /** The port the dev server listens on — PORT, or 3000. */
  port: number;
  lockPath?: string;
  fetchImpl?: typeof fetch;
  fs?: LockFs;
  pid?: number;
  /**
   * WALL clock, epoch ms. Used ONLY to stamp the lock file with an instant an
   * operator can read. No duration is measured here.
   */
  now?: () => number;
  /** Whether the pid in an existing lock file is still running. */
  isAlive?: (pid: number) => boolean;
  probeTimeoutMs?: number;
  warn?: (message: string) => void;
}

/** Raised when another client of the same providers is already live. */
export class ProviderBusyError extends Error {}

interface LockHolder {
  pid: number;
  startedAt: string;
}

function readHolder(fs: LockFs, lockPath: string): LockHolder | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const pid = (parsed as { pid?: unknown }).pid;
      const startedAt = (parsed as { startedAt?: unknown }).startedAt;
      if (typeof pid === 'number') {
        return { pid, startedAt: typeof startedAt === 'string' ? startedAt : 'unknown' };
      }
    }
  } catch {
    // Unreadable or unparseable: treated as stale below, never as a holder.
  }
  return null;
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Refuses to let a second client of adsbdb and adsb.lol start.
 *
 * scripts/build-route-cache.mjs runs for hours against the two providers the
 * dev server also polls — adsb.lol every 1.5 s, adsbdb every 10 s — and the
 * two processes do not coordinate. Simulated over three virtual hours, the
 * pair put 2 077 of adsbdb's 8 039 requests under the 1 500 ms floor and
 * 359 of adsb.lol's 7 380. Worse, the builder's 360 s silence after a 429 is
 * its own: a server left running sends 36 requests into each penalty, and by
 * this project's own measurement a request sent during the penalty RENEWS
 * it. The ban that followed cost this machine a working day.
 *
 * Two refusals, in this order: anything answering on the server port, then
 * another builder's lock file. The probe comes first because a server is the
 * likely case and must not leave a lock file behind.
 *
 * @returns the release function; call it on every exit path.
 */
export async function acquireProviderLock(deps: ProviderLockDeps): Promise<() => void> {
  const lockPath = deps.lockPath ?? DEFAULT_LOCK_PATH;
  const fs: LockFs = deps.fs ?? { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const pid = deps.pid ?? process.pid;
  const now = deps.now ?? Date.now;
  const isAlive = deps.isAlive ?? pidIsAlive;
  const warn = deps.warn ?? ((m: string) => console.warn(m));

  const url = `http://127.0.0.1:${deps.port}/health`;
  let listening: number | null = null;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(deps.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS),
    });
    listening = res.status;
  } catch {
    // Connection refused, DNS failure, timeout: nothing is there. Any status
    // at all, 503 included, means a server IS there and polling.
    listening = null;
  }
  if (listening !== null) {
    throw new ProviderBusyError(
      `something is listening on ${url} (HTTP ${listening}). The dev server polls adsb.lol every 1.5 s and adsbdb every 10 s; a second client on top of it is the pattern that got this machine banned. Stop it first: pkill -f "tsx watch server/index.ts"`
    );
  }

  if (fs.existsSync(lockPath)) {
    const holder = readHolder(fs, lockPath);
    if (holder !== null && holder.pid !== pid && isAlive(holder.pid)) {
      throw new ProviderBusyError(
        `another route-cache build is already running (pid ${holder.pid}, started ${holder.startedAt}) and holds ${lockPath}. Two builders are two uncoordinated request streams against adsbdb.`
      );
    }
    warn(
      `[lock] stale lock at ${lockPath} (${holder === null ? 'unreadable' : `pid ${holder.pid} is gone`}) — taking it over`
    );
  }

  const dir = dirname(lockPath);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ pid, startedAt: new Date(now()).toISOString() }));

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!fs.existsSync(lockPath)) return;
    const holder = readHolder(fs, lockPath);
    // Never delete a lock a LATER run took: releasing twice, or releasing
    // after a takeover, would unlock somebody else's run.
    if (holder !== null && holder.pid !== pid) return;
    fs.rmSync(lockPath, { force: true });
  };
}
