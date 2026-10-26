import { createPdfToolkit } from 'pdfstudio';

let toolkitPromise;

self.addEventListener('message', async (event) => {
  const { id, bytes, options = {} } = event.data || {};
  try {
    if (!bytes || !id) throw new Error('Invalid PDF optimization request.');
    toolkitPromise ||= createPdfToolkit();
    const toolkit = await toolkitPromise;
    let result = new Uint8Array(bytes);
    if (options.compress) result = await toolkit.compress(result);
    if (options.password) {
      result = await toolkit.lock(result, {
        userPassword: String(options.password),
        ownerPassword: String(options.password),
        keyLength: 256,
      });
    }
    const output = new Uint8Array(result);
    self.postMessage({ id, bytes: output.buffer }, [output.buffer]);
  } catch (error) {
    self.postMessage({ id, error: { name: error?.name || 'Error', message: error?.message || 'PDF optimization failed.' } });
  }
});
