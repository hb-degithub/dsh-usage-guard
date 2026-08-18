/**
 * zstd 会话日志扫描：dsh 的 session.jsonl.zstd 是串联帧容器（每次追加一帧）。
 * scanZstdFrames 逐字复制自 @deepseek-ai/dsh-session-persistence-jsonl
 * （lib/index.js 的 lib/types/zstd.js 区段），与官方读取路径保持同一套结构判定。
 */
import { zstdDecompressSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ZSTD_MAGIC = 4247762216;

export function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = blockHeader >>> 1 & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length === maxFrames) return { frames };
  }
  return { frames };
}

/** 解码一个日志的全部完整帧，按行解析 JSON；坏行与缺字段行跳过。 */
export function readSessionEvents(file) {
  const buffer = readFileSync(file);
  const { frames } = scanZstdFrames(buffer);
  const events = [];
  for (const f of frames) {
    const plain = zstdDecompressSync(buffer.subarray(f.start, f.end)).toString('utf8');
    for (const line of plain.split('\n')) {
      if (line === '') continue;
      try {
        const event = JSON.parse(line);
        if (typeof event?.type === 'string' && typeof event?.seq === 'number') events.push(event);
      } catch { /* 坏行跳过 */ }
    }
  }
  return events;
}

/** 递归列出 sessions 目录下所有 session.jsonl.zstd。 */
export function listSessionLogs(sessionsDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(dir, name);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(path);
      else if (name === 'session.jsonl.zstd') out.push(path);
    }
  };
  walk(sessionsDir);
  return out;
}
