import { parentPort, workerData } from 'node:worker_threads';

globalThis.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);
await import(workerData);
parentPort.on('message', data => globalThis.onmessage({ data }));
