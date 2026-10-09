/**
 * 会话日志扫描：读取 dsh 的 session 日志并还原为事件数组。
 *
 * 文件名随会话格式代次变化（@deepseek-ai/dsh-session-format 的规范命名）：
 * - v0：`session.jsonl`
 * - v1+：`session.v<N>.jsonl`（0.2.0 当前代次为 v4）
 * 压缩后缀由持久化后端决定，默认 zstd：`session.jsonl.zstd` / `session.v4.jsonl.zstd`。
 * 同一会话目录可能同时存在多个代次（迁移产物），按 dsh 自己的规则取代次最高者。
 *
 * zstd 是串联帧容器（每次追加一帧）；scanZstdFrames 逐字复制自
 * @deepseek-ai/dsh-session-persistence-jsonl 的帧结构判定，与官方读取路径一致。
 */
import { zstdDecompressSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const ZSTD_MAGIC = 4247762216;

/** 规范日志名：session[.vN].jsonl[.zstd]，N 为不带前导零的正整数（与 dsh 的判定一致）。 */
const SESSION_LOG_NAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl(\.zstd)?$/;

/**
 * 解析一个日志文件名。
 * @param name 目录项名称。
 * @returns `{ generation, zstd }`；不是规范日志名时返回 undefined。
 */
export function parseSessionLogName(name) {
  const match = SESSION_LOG_NAME.exec(name);
  if (match === null) return undefined;
  return { generation: match[1] === undefined ? 0 : Number(match[1]), zstd: match[2] !== undefined };
}

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

/** 按后缀解码整份日志为文本：zstd 串联帧逐帧解压，纯 jsonl 直接读。 */
function decodeLogText(file) {
  const buffer = readFileSync(file);
  if (!file.endsWith('.zstd')) return buffer.toString('utf8');
  const { frames } = scanZstdFrames(buffer);
  let text = '';
  for (const f of frames) text += zstdDecompressSync(buffer.subarray(f.start, f.end)).toString('utf8');
  return text;
}

/**
 * 读取一个会话日志：一次遍历同时取出会话 id（`session` 头行）与带 seq 的事件。
 * 坏行与缺字段行跳过；头行（无 seq）不进事件数组。
 * @param file 日志文件路径。
 * @returns `{ sessionId, events }`；日志头缺 id 时退回会话目录名。
 */
export function readSessionLog(file) {
  const events = [];
  let sessionId;
  for (const line of decodeLogText(file).split('\n')) {
    if (line === '') continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // 坏行跳过
    }
    if (sessionId === undefined && event?.type === 'session' && typeof event.id === 'string') sessionId = event.id;
    if (typeof event?.type === 'string' && typeof event?.seq === 'number') events.push(event);
  }
  return { sessionId: sessionId ?? basename(dirname(file)), events };
}

/** 解码一个日志的全部事件，按行解析 JSON；坏行与缺字段行跳过。 */
export function readSessionEvents(file) {
  return readSessionLog(file).events;
}

/**
 * 递归列出 sessions 目录下所有会话日志，每个会话目录只保留代次最高的那份
 * （与 @deepseek-ai/dsh-session-persistence-jsonl 的「取最高规范代次」规则一致）。
 * 同代次并存时取「最近被写过」的那份：改了压缩方式（zstd ↔ none）后旧文件会留着，
 * 固定按后缀偏好可能一直读旧文件、新用量永远不入账；同等 mtime 时再偏好 zstd。
 * @param sessionsDir sessions 根目录。
 * @returns 日志路径数组，按路径排序。
 */
export function listSessionLogs(sessionsDir) {
  const best = new Map(); // 目录 -> { path, generation, mtimeMs, zstd }
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
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      const parsed = parseSessionLogName(name);
      if (parsed === undefined) continue;
      const current = best.get(dir);
      const better = current === undefined
        || parsed.generation > current.generation
        || (parsed.generation === current.generation && (
          stat.mtimeMs > current.mtimeMs
          || (stat.mtimeMs === current.mtimeMs && parsed.zstd && !current.zstd)
        ));
      if (better) best.set(dir, { path, mtimeMs: stat.mtimeMs, ...parsed });
    }
  };
  walk(sessionsDir);
  return [...best.values()].map((entry) => entry.path).sort();
}
