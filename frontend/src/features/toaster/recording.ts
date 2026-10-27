import type { ToasterMeta, ToasterSongFiles } from './contracts.ts';
import type { EngineTape } from './upstream/tape.js';
import type { TapeOperation, WorkerResponse } from './export-protocol.ts';

const EXPORT_TIMEOUT_MS = 60_000;

// The worker owns the real upstream tape. Forwarding small bar events keeps even a
// long recording's tape traversal and structured cloning off the playback thread.
export function createRecording() {
  let worker: Worker | null = null;
  let unavailable = false;
  let disposed = false;
  let currentBars = 0;
  let longestBars = 0;
  let nextId = 0;
  let pending: {
    id: number;
    promise: Promise<ToasterSongFiles | null>;
    resolve: (files: ToasterSongFiles | null) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;

  function stop(error?: Error) {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    currentBars = longestBars = 0;
    if (pending) {
      const request = pending;
      pending = null;
      clearTimeout(request.timeout);
      if (error) request.reject(error); else request.resolve(null);
    }
  }
  function fail(error: Error) {
    unavailable = true;
    stop(error);
  }
  function start() {
    if (worker || unavailable || disposed) return worker;
    try {
      worker = new Worker(new URL('./export-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (!pending || data.id !== pending.id) return;
        if (data.error) { fail(new Error(data.error)); return; }
        const request = pending;
        pending = null;
        clearTimeout(request.timeout);
        request.resolve(data.files);
      };
      worker.onerror = event => {
        event.preventDefault();
        fail(new Error(event.message || 'The song could not be exported.'));
      };
      worker.onmessageerror = () => fail(new Error('The song export could not be read.'));
    } catch {
      unavailable = true;
      stop();
    }
    return worker;
  }
  function send(operation: TapeOperation) {
    try { worker?.postMessage(operation); }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  }
  const tape: EngineTape = {
    reset() { stop(); unavailable = false; },
    lock(...args) {
      if (!start()) return;
      currentBars = 0;
      send({ type: 'lock', args });
    },
    tempo(...args) { send({ type: 'tempo', args }); },
    shift(...args) { send({ type: 'shift', args }); },
    pattern(...args) {
      if (!worker) return;
      send({ type: 'pattern', args });
      if (worker) { currentBars++; longestBars = Math.max(longestBars, currentBars); }
    },
    harmony(...args) { send({ type: 'harmony', args }); },
  };
  return {
    tape,
    get bars() { return longestBars; },
    files(meta: ToasterMeta, down: number): Promise<ToasterSongFiles | null> {
      if (!worker || disposed || longestBars < 4) return Promise.resolve(null);
      if (pending) return pending.promise;
      let resolve!: (files: ToasterSongFiles | null) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<ToasterSongFiles | null>((done, failed) => { resolve = done; reject = failed; });
      const id = ++nextId;
      const timeout = setTimeout(() => fail(new Error('The song export took too long.')), EXPORT_TIMEOUT_MS);
      pending = { id, promise, resolve, reject, timeout };
      try { worker.postMessage({ type: 'export', id, meta, down }); }
      catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      return promise;
    },
    dispose() { if (!disposed) { disposed = true; stop(); } },
  };
}
