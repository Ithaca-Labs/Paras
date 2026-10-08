import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FixtureFetchOptions {
  /** Directory (path or file URL) holding this fixture set, e.g. test/fixtures/polymarket. */
  dir: string | URL;
  /** Force record/replay. Default: record only when RECORD_FIXTURES=1. */
  record?: boolean;
  /** Real network fetch used when recording. */
  realFetch?: typeof fetch;
}

interface FixtureFile {
  request: { method: string; url: string; body?: string };
  response: { status: number; headers: Record<string, string>; body: unknown };
}

const isJson = (contentType: string) => /json/i.test(contentType);

/** Stable, human-readable file name for a request. */
export function fixtureName(method: string, url: string, body?: string): string {
  const u = new URL(url);
  const slug = `${u.host}${u.pathname}`.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const hash = createHash('sha1').update(`${method} ${url}\n${body ?? ''}`).digest('hex').slice(0, 8);
  return `${method.toUpperCase()}_${slug}_${hash}.json`;
}

/**
 * A `fetch` that replays recorded responses (default) or records real ones (RECORD_FIXTURES=1).
 * Pass it to anything that takes an injectable fetch (Venue adapters). Replay never touches
 * the network; a missing fixture throws with the command to record it.
 */
export function createFixtureFetch(options: FixtureFetchOptions): typeof fetch {
  const dir = options.dir instanceof URL ? fileURLToPath(options.dir) : options.dir;
  const record = options.record ?? process.env.RECORD_FIXTURES === '1';
  if (record && process.env.CI) throw new Error('RECORD_FIXTURES is not allowed in CI');
  const realFetch = options.realFetch ?? fetch;

  return async (input, init) => {
    const req = new Request(input, init);
    const body = req.body ? await req.clone().text() : undefined;
    const file = join(dir, fixtureName(req.method, req.url, body));

    if (record) {
      const res = await realFetch(req);
      const contentType = res.headers.get('content-type') ?? '';
      const text = await res.clone().text();
      const fixture: FixtureFile = {
        // Only the content-type is stored: never persist cookies or auth headers.
        request: { method: req.method, url: req.url, ...(body ? { body } : {}) },
        response: {
          status: res.status,
          headers: { 'content-type': contentType },
          body: isJson(contentType) ? JSON.parse(text) : text,
        },
      };
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n');
      return res;
    }

    if (!existsSync(file)) {
      throw new Error(
        `No fixture for ${req.method} ${req.url}\n  expected: ${file}\n  record it with: RECORD_FIXTURES=1 pnpm test`,
      );
    }
    const { response } = JSON.parse(readFileSync(file, 'utf8')) as FixtureFile;
    const payload = isJson(response.headers['content-type'] ?? '')
      ? JSON.stringify(response.body)
      : String(response.body);
    return new Response(payload, { status: response.status, headers: response.headers });
  };
}
