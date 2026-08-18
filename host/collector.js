/**
 * 采集器：实时事件 + 幂等历史回填。
 * 每会话一份折叠状态（持久化在 store.sessions），事件按会话缓冲，
 * 该会话回填完成后按 seq 冲刷；applyEvent 的 lastSeq 水位保证不重复计数。
 */
import { applyEvent } from './fold.js';
import { readSessionEvents, listSessionLogs } from './logscan.js';

export class Collector {
  constructor(store, sessionsDir) {
    this.store = store;
    this.sessionsDir = sessionsDir;
    this.folds = new Map();     // sessionId -> FoldState（内存工作副本）
    this.buffers = new Map();   // sessionId -> event[]（回填前到达的实时事件）
    this.ready = new Set();     // 已完成回填的 sessionId
    this.backfilled = false;
  }

  foldOf(sessionId) {
    let fold = this.folds.get(sessionId);
    if (fold === undefined) {
      fold = this.store.foldStateOf(sessionId);
      this.folds.set(sessionId, fold);
    }
    return fold;
  }

  /** 应用一个事件并把状态/增量写回 store。 */
  applyOne(sessionId, event) {
    const { state, delta } = applyEvent(this.foldOf(sessionId), event);
    this.folds.set(sessionId, state);
    if (delta !== null) this.store.recordDelta(sessionId, delta, state);
    else this.store.noteState(sessionId, state);
  }

  /** 实时事件入口：全局回填未完成前先缓冲。
   *  backfill() 主体完全同步（无 await），事件只可能在其开始前交错到达；
   *  回填结束后再按 ready 缓冲会让纯实时新会话的事件永远无人冲刷。 */
  handleEvent(sessionId, event) {
    if (!this.backfilled) {
      const buffer = this.buffers.get(sessionId) ?? [];
      buffer.push(event);
      this.buffers.set(sessionId, buffer);
      return;
    }
    this.applyOne(sessionId, event);
  }

  /** 重放一个会话的日志，返回日志末尾的折叠状态。 */
  replayLog(sessionId, events) {
    for (const event of events) this.applyOne(sessionId, event);
  }

  /** 冲刷一个会话缓冲的实时事件（按 seq 排序；水位保护重复）。 */
  drain(sessionId) {
    const buffer = this.buffers.get(sessionId);
    if (buffer === undefined) return;
    this.buffers.delete(sessionId);
    buffer.sort((a, b) => a.seq - b.seq);
    for (const event of buffer) this.applyOne(sessionId, event);
  }

  async backfill() {
    for (const file of listSessionLogs(this.sessionsDir)) {
      const sessionId = file.split(/[\\/]/).slice(-2)[0];
      try {
        this.replayLog(sessionId, readSessionEvents(file));
      } catch {
        // 单个坏日志不阻断整体回填
      }
      this.ready.add(sessionId);
      this.drain(sessionId);
    }
    // 没有日志的纯实时会话：直接冲刷
    for (const sessionId of [...this.buffers.keys()]) {
      this.ready.add(sessionId);
      this.drain(sessionId);
    }
    this.backfilled = true;
    this.store.flush();
  }

  flush() {
    this.store.flush();
  }
}
