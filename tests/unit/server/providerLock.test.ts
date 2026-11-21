// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { acquireProviderLock, ProviderBusyError, DEFAULT_LOCK_PATH } from '../../../server/providerLock';
import type { LockFs } from '../../../server/providerLock';

/**
 * Two uncoordinated clients on the same two providers is the pattern that
 * banned this machine: the dev server polls adsb.lol every 1.5 s and pumps
 * adsbdb every 10 s, and the offline builder adds its own stream on top of
 * both. Simulated over three virtual hours, the pair put 2 077 of adsbdb's
 * 8 039 requests closer together than the 1 500 ms floor — and the builder's
 * 360 s silence after a 429 is not shared, so a server left running sends 36
 * ban-RENEWING requests into every penalty the builder is waiting out.
 *
 * So the builder refuses to start. These are the refusals.
 */
function memoryFs(seed: Record<string, string> = {}): LockFs & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFileSync: (p, data) => {
      files.set(p, data);
    },
    mkdirSync: () => {},
    rmSync: (p) => {
      files.delete(p);
    },
  };
}

const refused = (): Promise<Response> => {
  const err = new Error('fetch failed');
  (err as Error & { cause?: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3000'), {
    code: 'ECONNREFUSED',
  });
  return Promise.reject(err);
};

const answering = (status = 200): (() => Promise<Response>) => () =>
  Promise.resolve(new Response('{"status":"ok"}', { status }));

describe('acquireProviderLock', () => {
  it('refuses to start while something answers on the server port', async () => {
    const fs = memoryFs();
    await expect(
      acquireProviderLock({ port: 3000, fetchImpl: answering(), fs, lockPath: 'lock' })
    ).rejects.toBeInstanceOf(ProviderBusyError);
    // And it must not have taken the lock on its way out.
    expect(fs.files.size).toBe(0);
  });

  it('refuses whatever status the listener answers with', async () => {
    // A server whose feed is degraded answers 503 on /health. It is still a
    // server, and it is still polling adsb.lol every 1.5 s.
    const fs = memoryFs();
    await expect(
      acquireProviderLock({ port: 3000, fetchImpl: answering(503), fs, lockPath: 'lock' })
    ).rejects.toThrow(/127\.0\.0\.1:3000/);
  });

  it('probes the loopback address on the port it was given', async () => {
    const seen: string[] = [];
    const fs = memoryFs();
    await acquireProviderLock({
      port: 8080,
      fetchImpl: (input) => {
        seen.push(String(input));
        return refused();
      },
      fs,
      lockPath: 'lock',
    });
    expect(seen).toEqual(['http://127.0.0.1:8080/health']);
  });

  it('starts when nothing is listening, and records who holds the lock', async () => {
    const fs = memoryFs();
    const release = await acquireProviderLock({
      port: 3000,
      fetchImpl: refused,
      fs,
      lockPath: 'lock',
      pid: 4242,
      now: () => Date.parse('2026-11-21T04:00:00.000Z'),
    });
    expect(JSON.parse(fs.files.get('lock') ?? '{}')).toEqual({
      pid: 4242,
      startedAt: '2026-11-21T04:00:00.000Z',
    });
    release();
    expect(fs.files.has('lock')).toBe(false);
  });

  it('refuses while another builder holds the lock, and leaves that lock alone', async () => {
    const held = JSON.stringify({ pid: 99, startedAt: '2026-11-21T01:00:00.000Z' });
    const fs = memoryFs({ lock: held });
    await expect(
      acquireProviderLock({
        port: 3000,
        fetchImpl: refused,
        fs,
        lockPath: 'lock',
        pid: 4242,
        isAlive: (pid) => pid === 99,
      })
    ).rejects.toThrow(/99/);
    expect(fs.files.get('lock')).toBe(held);
  });

  it('takes over a lock whose owner is gone, loudly', async () => {
    // A run killed with SIGKILL leaves its lock behind. Refusing for ever
    // afterwards would make the guard the thing operators learn to delete.
    const warnings: string[] = [];
    const fs = memoryFs({ lock: JSON.stringify({ pid: 99, startedAt: '2026-11-20T01:00:00.000Z' }) });
    const release = await acquireProviderLock({
      port: 3000,
      fetchImpl: refused,
      fs,
      lockPath: 'lock',
      pid: 4242,
      isAlive: () => false,
      warn: (m) => warnings.push(m),
    });
    expect(warnings.join(' ')).toMatch(/stale/i);
    expect(JSON.parse(fs.files.get('lock') ?? '{}').pid).toBe(4242);
    release();
  });

  it('takes over a lock it cannot parse', async () => {
    const fs = memoryFs({ lock: 'not json' });
    const release = await acquireProviderLock({
      port: 3000, fetchImpl: refused, fs, lockPath: 'lock', pid: 7, warn: () => {},
    });
    expect(JSON.parse(fs.files.get('lock') ?? '{}').pid).toBe(7);
    release();
  });

  it('never deletes a lock that is no longer ours, however often it is called', async () => {
    // Our run is killed, a later one takes the lock over, and only then does
    // our exit handler fire. Releasing here would unlock somebody else's run
    // — and the whole point of the lock is that the second run never starts.
    const fs = memoryFs();
    const release = await acquireProviderLock({
      port: 3000, fetchImpl: refused, fs, lockPath: 'lock', pid: 4242,
    });
    fs.files.set('lock', JSON.stringify({ pid: 777, startedAt: 'later' }));
    release();
    release();
    expect(JSON.parse(fs.files.get('lock') ?? '{}').pid).toBe(777);
  });

  it('releases on the way out, and a second call changes nothing', async () => {
    const fs = memoryFs();
    const release = await acquireProviderLock({
      port: 3000, fetchImpl: refused, fs, lockPath: 'lock', pid: 4242,
    });
    release();
    expect(fs.files.has('lock')).toBe(false);
    release();
    expect(fs.files.has('lock')).toBe(false);
  });

  it('defaults the lock to the directory the cache itself lives in', () => {
    expect(DEFAULT_LOCK_PATH).toBe('server/data/.build-routes.lock');
  });
});
