import { createTape, songMidi, songStrudel } from './upstream/tape.js';
import { cleanMeta } from './export-protocol.ts';
import type { WorkerRequest, WorkerResponse } from './export-protocol.ts';

// All tape traversal and full-song code/MIDI generation run off the UI thread.
const tape = createTape();
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void;
  postMessage(data: WorkerResponse, transfer?: Transferable[]): void;
};
scope.onmessage = ({ data }) => {
  if (data.type !== 'export') {
    switch (data.type) {
      case 'lock': tape.lock(...data.args); break;
      case 'tempo': tape.tempo(...data.args); break;
      case 'shift': tape.shift(...data.args); break;
      case 'pattern': tape.pattern(...data.args); break;
      case 'harmony': tape.harmony(...data.args); break;
    }
    return;
  }
  try {
    const song = tape.song(data.down);
    if (!song) { scope.postMessage({ id: data.id, files: null }); return; }
    const meta = cleanMeta(data.meta);
    const name = meta.title || 'Lark';
    const about = meta.artist ? `${name} by ${meta.artist}` : name;
    const code = songStrudel(song, about);
    if (!code) { scope.postMessage({ id: data.id, files: null }); return; }
    const midi = songMidi(song, name);
    scope.postMessage({ id: data.id, files: { code, midi, bars: song.bars.length } }, [midi.buffer]);
  } catch (error) {
    scope.postMessage({ id: data.id, files: null, error: error instanceof Error ? error.message : String(error) });
  }
};
