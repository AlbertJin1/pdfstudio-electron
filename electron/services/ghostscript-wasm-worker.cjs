// Runs one Ghostscript job inside a throw-away worker thread using the bundled WebAssembly build.
// A fresh instance per job keeps jobs isolated (Ghostscript's main() is not safely re-entrant) and lets the
// caller enforce a timeout by terminating the worker, without ever blocking Electron's main thread.
const { parentPort, workerData } = require('node:worker_threads');

async function run() {
  const { modulePath, wasmBytes, files = [], args = [], outputName } = workerData;
  const createGhostscript = require(modulePath);
  const stdout = [];
  const stderr = [];
  const mod = {
    noInitialRun: true,
    print: (line) => { if (stdout.length < 200) stdout.push(String(line)); },
    printErr: (line) => { if (stderr.length < 200) stderr.push(String(line)); },
    // The package tries a browser-style fetch() for its binary; hand it the bytes instead (works from asar too).
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(wasmBytes, imports).then((result) => done(result.instance, result.module), (error) => parentPort.postMessage({ ok: false, error: `Could not start the bundled Ghostscript engine: ${error.message}` }));
      return {};
    },
  };
  createGhostscript(mod); // never await: the Emscripten instance is thenable and would resolve forever
  const started = Date.now();
  while (!mod.calledRun) {
    if (Date.now() - started > 60000) throw new Error('The bundled Ghostscript engine did not start in time.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  mod.FS.mkdir('/work');
  for (const file of files) mod.FS.writeFile(`/work/${file.name}`, file.data);
  let status = 0;
  try { status = mod.callMain(args); } catch (error) { status = typeof error?.status === 'number' ? error.status : 1; if (typeof error?.status !== 'number') stderr.push(String(error?.message || error)); }
  if (status !== 0) throw new Error(stderr.filter(Boolean).slice(-8).join(' ').slice(0, 1800) || `Ghostscript exited with code ${status}.`);
  if (!outputName) return parentPort.postMessage({ ok: true, stdout: stdout.join('\n') });
  const output = mod.FS.readFile(`/work/${outputName}`);
  // Ghostscript can exit 0 after printing a fatal-looking error and writing an empty shell document.
  if (output.length < 2048 && stderr.some((line) => /\*{4}\s*(Error|Unrecoverable)/i.test(line))) throw new Error(stderr.filter(Boolean).slice(-4).join(' ').slice(0, 600) || 'Ghostscript could not read this PDF.');
  const copy = new Uint8Array(output); // detach from the WASM heap
  parentPort.postMessage({ ok: true, bytes: copy, stdout: stdout.join('\n') }, [copy.buffer]);
}

run().catch((error) => parentPort.postMessage({ ok: false, error: String(error?.message || error) }));
