let worker;
let requestId = 0;
const pending = new Map();

function rejectPending(error) {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function getWorker() {
  if (worker) return worker;
  if (typeof Worker === 'undefined') throw new Error('PDF encryption and compression require Web Worker support.');
  worker = new Worker(new URL('./pdfToolkit.worker.js', import.meta.url), { type: 'module', name: 'pdfstudio-qpdf-worker' });
  worker.onmessage = (event) => {
    const { id, bytes, error } = event.data || {};
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (error) {
      const failure = new Error(error.message || 'PDF optimization failed.');
      failure.name = error.name || 'Error';
      request.reject(failure);
    } else {
      request.resolve(new Uint8Array(bytes));
      // Drop the encryption worker after password work so its transient JS/WASM memory is released.
      if (request.discardWorker) { worker?.terminate(); worker = undefined; }
    }
  };
  worker.onerror = (event) => {
    const failure = new Error(event.message || 'The PDF optimization worker failed to start.');
    rejectPending(failure);
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

/** Apply lossless QPDF recompression and/or AES-256 password encryption off the UI thread. */
export function finalizePdfBytes(bytes, options = {}) {
  const activeWorker = getWorker();
  const id = ++requestId;
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Always transfer an isolated buffer so the caller's source bytes remain intact.
  const transferable = input.slice().buffer;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, discardWorker: Boolean(options.password) });
    try {
      activeWorker.postMessage({ id, bytes: transferable, options }, [transferable]);
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}
