// Test-only preload: the local sandbox forbids piped child processes (spawn
// with stdio pipes throws EPERM synchronously). Vite probes `net use` once on
// Windows via exec(); swallow that synchronous EPERM so the exec callback
// receives the error asynchronously (vite treats it as "no mapped drives").
// Loaded via NODE_OPTIONS=--require; never shipped (dev-only file).
'use strict';
const cp = require('node:child_process');

function swallowSyncEperm(original) {
  return function (...args) {
    try {
      return original.apply(this, args);
    } catch (err) {
      if (!err || err.code !== 'EPERM') throw err;
      const cb = args.find((a) => typeof a === 'function');
      if (cb) process.nextTick(() => cb(err));
      const { EventEmitter } = require('node:events');
      const dummy = new EventEmitter();
      dummy.pid = 0;
      dummy.kill = () => true;
      return dummy;
    }
  };
}

cp.exec = swallowSyncEperm(cp.exec);
cp.execFile = swallowSyncEperm(cp.execFile);
