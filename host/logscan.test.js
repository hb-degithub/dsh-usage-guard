import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zstdCompressSync, constants } from 'node:zlib';
import { scanZstdFrames, readSessionEvents, readSessionLog, listSessionLogs, parseSessionLogName } from './logscan.js';

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

describe('generation-addressed log names (dsh 0.2.0 / session format v4)', () => {
  it('recognizes canonical names only', () => {
    expect(parseSessionLogName('session.jsonl')).toEqual({ generation: 0, zstd: false });
    expect(parseSessionLogName('session.jsonl.zstd')).toEqual({ generation: 0, zstd: true });
    expect(parseSessionLogName('session.v4.jsonl.zstd')).toEqual({ generation: 4, zstd: true });
    expect(parseSessionLogName('session.v12.jsonl')).toEqual({ generation: 12, zstd: false });
    // 非规范名（临时文件、前导零、.v0、别的文件名）不算会话日志
    for (const name of ['session.v04.jsonl.zstd', 'session.v0.jsonl', 'session.tmp.jsonl.zstd', 'events.jsonl.zstd', 'session.v4.jsonl.zstd.tmp']) {
      expect(parseSessionLogName(name), name).toBeUndefined();
    }
  });

  it('discovers session.v4.jsonl.zstd and ignores non-canonical siblings', () => {
    const sessionDir = join(dir, '--H-ws--', 'session-93b954e0');
    mkdirSync(sessionDir, { recursive: true });
    const log = join(sessionDir, 'session.v4.jsonl.zstd');
    writeFileSync(log, frame('{"type":"session","version":4,"id":"session-93b954e0"}\n{"type":"assistant/message","seq":1}\n'));
    writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd.tmp'), 'x');
    expect(listSessionLogs(dir)).toEqual([log]);
    expect(readSessionEvents(log)).toEqual([{ type: 'assistant/message', seq: 1 }]);
  });

  it('keeps only the highest generation of one session directory', () => {
    const sessionDir = join(dir, '--H-ws--', 'session-old');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.jsonl.zstd'), frame('{"type":"session","id":"old"}\n'));
    writeFileSync(join(sessionDir, 'session.v3.jsonl.zstd'), frame('{"type":"session","id":"v3"}\n'));
    writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), frame('{"type":"session","id":"v4"}\n'));
    expect(listSessionLogs(dir)).toEqual([join(sessionDir, 'session.v4.jsonl.zstd')]);
  });

  it('prefers zstd over plaintext at the same generation', () => {
    const sessionDir = join(dir, '--H-ws--', 'session-both');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.v4.jsonl'), '{"type":"session","id":"plain"}\n');
    writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), frame('{"type":"session","id":"zstd"}\n'));
    expect(listSessionLogs(dir)).toEqual([join(sessionDir, 'session.v4.jsonl.zstd')]);
  });

  it('reads an uncompressed .jsonl log (compression: none)', () => {
    const log = join(dir, 'session.v4.jsonl');
    writeFileSync(log, '{"type":"session","version":4,"id":"session-plain"}\n{"type":"assistant/message","seq":7,"time":1786953434034}\n');
    expect(readSessionLog(log)).toEqual({
      sessionId: 'session-plain',
      events: [{ type: 'assistant/message', seq: 7, time: 1786953434034 }],
    });
  });

  it('takes the session id from the log header, falling back to the directory name', () => {
    const sessionDir = join(dir, '--H-ws--', 'session-abc');
    mkdirSync(sessionDir, { recursive: true });
    const withHeader = join(sessionDir, 'session.v4.jsonl.zstd');
    writeFileSync(withHeader, frame('{"type":"session","version":4,"id":"session-real-id"}\n{"type":"assistant/message","seq":1}\n'));
    expect(readSessionLog(withHeader).sessionId).toBe('session-real-id');

    const withoutHeader = join(sessionDir, 'session.v3.jsonl.zstd');
    writeFileSync(withoutHeader, frame('{"type":"assistant/message","seq":1}\n'));
    expect(readSessionLog(withoutHeader).sessionId).toBe('session-abc');
  });
});
