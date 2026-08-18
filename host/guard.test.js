import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from './store.js';
import { installGuard } from './guard.js';
import { initFold, dayOf } from './fold.js';

let dir, store, listener;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'guard-'));
  store = new Store(join(dir, 's.json')); store.load();
  const ctx = { on: (event, cb) => { listener = cb; return () => {}; } };
  installGuard(ctx, store);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function overLimit() {
  const today = dayOf(Date.now());
  store.recordDelta('s1', { day: today, provider: 'p', model: 'm', input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, requests: 1 }, initFold());
  store.setConfig({ prices: store.data.config.prices, guard: { dailyTokens: 10, dailyCost: null, mode: 'block' } });
}

describe('guard', () => {
  it('passes requests through in warn mode even when over the limit', async () => {
    overLimit();
    store.setConfig({ prices: store.data.config.prices, guard: { dailyTokens: 10, dailyCost: null, mode: 'warn' } });
    const next = (req) => `ok:${req}`;
    expect(await listener('req-1', next)).toBe('ok:req-1');
  });

  it('rejects in block mode when over the limit, with a clear message', async () => {
    overLimit();
    const next = (req) => `ok:${req}`;
    // 守卫监听同步抛错（cordis 瀑布中断语义，dsh-llm middleware failures remain thrown）
    expect(() => listener('req-1', next)).toThrow(/用量上限|usage limit/i);
  });

  it('passes in block mode when under the limit', async () => {
    const next = (req) => `ok:${req}`;
    expect(await listener('req-1', next)).toBe('ok:req-1');
  });
});
