import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zstdCompressSync, constants } from 'node:zlib';
import { scanZstdFrames, readSessionEvents, listSessionLogs } from './logscan.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'logscan-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const frame = (text) => zstdCompressSync(Buffer.from(text, 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } });

describe('scanZstdFrames + readSessionEvents', () => {
  it('decodes concatenated frames in order', () => {
    const a = frame(JSON.stringify({ type: 'session', seq: 0 }) + '\n');
    const b = frame(JSON.stringify({ type: 'request/header', seq: 12 }) + '\n' + JSON.stringify({ type: 'assistant/chunk', seq: 15 }) + '\n');
    const file = join(dir, 'session.jsonl.zstd');
    writeFileSync(file, Buffer.concat([a, b]));
    const events = readSessionEvents(file);
    expect(events.map((e) => e.seq)).toEqual([0, 12, 15]);
    const { frames } = scanZstdFrames(readFileSync(file));
    expect(frames.length).toBe(2);
  });

  it('skips broken JSON lines inside a frame', () => {
    const file = join(dir, 'session.jsonl.zstd');
    writeFileSync(file, frame('{"type":"a","seq":1}\nnot-json\n'));
    expect(readSessionEvents(file)).toEqual([{ type: 'a', seq: 1 }]);
  });
});

describe('listSessionLogs', () => {
  it('finds nested session.jsonl.zstd files and tolerates a missing dir', () => {
    const nested = join(dir, '--H-ws--', 'session-abc');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'session.jsonl.zstd'), frame('{"type":"session"}\n'));
    writeFileSync(join(nested, 'other.txt'), 'x');
    expect(listSessionLogs(dir)).toEqual([join(nested, 'session.jsonl.zstd')]);
    expect(listSessionLogs(join(dir, 'missing'))).toEqual([]);
  });
});
