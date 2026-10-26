import { parentPort } from 'node:worker_threads';
import { createPdfToolkit } from 'pdfstudio';

let toolkitPromise;

parentPort?.on('message', async (message) => {
  const { id, bytes, options = {} } = message || {};
  try {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid PDF optimization request ID.');
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) throw new Error('No valid PDF data was supplied for optimization.');

    toolkitPromise ||= createPdfToolkit();
    const toolkit = await toolkitPromise;
    let result = new Uint8Array(bytes);

    if (options.compress) {
      if (typeof toolkit.compress !== 'function') throw new Error('The PDF engine does not support lossless compression. Reinstall PDF Studio dependencies.');
      result = await toolkit.compress(result);
    }
    if (options.password) {
      if (typeof toolkit.lock !== 'function') throw new Error('The PDF engine does not support password protection. Reinstall PDF Studio dependencies.');
      result = await toolkit.lock(result, {
        userPassword: String(options.password),
        ownerPassword: String(options.password),
        keyLength: 256,
      });
    }

    const output = Uint8Array.from(result);
    parentPort?.postMessage({ id, bytes: output.buffer }, [output.buffer]);
  } catch (error) {
    parentPort?.postMessage({
      id,
      error: {
        name: String(error?.name || 'Error'),
        message: String(error?.message || 'PDF optimization failed.'),
      },
    });
  }
});
