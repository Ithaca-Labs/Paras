import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureFetch } from '../src/index.js';

const dir = new URL('./fixtures/example/', import.meta.url);

describe('fixture replay', () => {
  it('replays a recorded response without touching the network', async () => {
    const realFetch = (() => {
      throw new Error('network used');
    }) as typeof fetch;
    const f = createFixtureFetch({ dir, record: false, realFetch });
    const res = await f('https://api.example.test/markets?limit=1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'm1', question: 'Will it rain tomorrow?', yes: 0.42 }]);
  });

  it('fails with a hint when a fixture is missing', async () => {
    const f = createFixtureFetch({ dir, record: false });
    await expect(f('https://api.example.test/other')).rejects.toThrow(/RECORD_FIXTURES=1/);
  });
});

describe('fixture record', () => {
  it('writes the response (content-type only) so it can be replayed', async () => {
    const out = mkdtempSync(join(tmpdir(), 'fixtures-'));
    const realFetch = (async () =>
      Response.json({ ok: true }, { headers: { 'set-cookie': 'secret=1' } })) as typeof fetch;

    const recorder = createFixtureFetch({ dir: out, record: true, realFetch });
    await recorder('https://api.example.test/ping');

    const [file] = readdirSync(out);
    expect(readFileSync(join(out, file!), 'utf8')).not.toContain('secret');

    const replay = createFixtureFetch({ dir: out, record: false });
    expect(await (await replay('https://api.example.test/ping')).json()).toEqual({ ok: true });
  });
});
