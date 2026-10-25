const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const mammoth = require('mammoth');

// Keep data beside the executable for true portable builds (Windows portable EXE and Linux AppImage).
// If the portable folder is read-only (for example, a USB drive mounted read-only), gracefully use the
// normal per-user application-data folder rather than failing to start.
function configurePortableUserData() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const appImagePath = process.env.APPIMAGE;
  const candidateDir = portableDir || (appImagePath ? path.dirname(appImagePath) : null);
  if (!candidateDir) return;
  const candidate = path.join(candidateDir, 'PDF Studio Data');
  try {
    fsSync.mkdirSync(candidate, { recursive: true });
    const probe = path.join(candidate, `.write-test-${process.pid}`);
    fsSync.writeFileSync(probe, 'ok');
    fsSync.unlinkSync(probe);
    app.setPath('userData', candidate);
  } catch {
    // Electron's default userData location remains the safe fallback.
  }
}
configurePortableUserData();

let mainWindow;

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  if (data && typeof data === 'object') return Buffer.from(Object.values(data));
  throw new TypeError('No valid file data was supplied.');
}

function safeName(value, fallback = 'document') {
  const name = path.basename(String(value || fallback)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return name || fallback;
}

async function docxBufferToPdf(buffer) {
  const result = await mammoth.convertToHtml({ buffer });
  const body = result.value || '<p>This Word document contains no readable text.</p>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 22mm 20mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #202236; font-size: 11pt; line-height: 1.55; }
    h1,h2,h3 { page-break-after: avoid; } p { orphans: 3; widows: 3; }
    table { border-collapse: collapse; width: 100%; } td,th { border: 1px solid #d7d9e2; padding: 5px; }
    img { max-width: 100%; height: auto; }
    blockquote { border-left: 3px solid #8066f6; margin-left: 0; padding-left: 12px; color: #555b71; }
  </style></head><body>${body}</body></html>`;
  const printWindow = new BrowserWindow({
    show: false,
    width: 980,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    show: false,
    frame: false,
    backgroundColor: '#f6f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize-toggle', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()));
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new TypeError('Only HTTPS links are allowed.');
  return shell.openExternal(url);
});

ipcMain.handle('files:open', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Add documents to PDF Studio',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Supported documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'docx'] }],
  });
  if (picked.canceled) return [];
  const output = [];
  for (const filePath of picked.filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    const raw = await fs.readFile(filePath);
    if (ext === '.docx') {
      const data = await docxBufferToPdf(raw);
      output.push({ name: `${path.basename(filePath, ext)}.pdf`, originName: path.basename(filePath), path: filePath, mime: 'application/pdf', kind: 'pdf', bytes: new Uint8Array(data) });
    } else {
      const mimeByExt = {
        '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
      };
      output.push({ name: path.basename(filePath), path: filePath, mime: mimeByExt[ext] || 'application/octet-stream', kind: ext === '.pdf' ? 'pdf' : 'image', bytes: new Uint8Array(raw) });
    }
  }
  return output;
});

ipcMain.handle('files:save', async (_event, { name, data, filters }) => {
  const safeFile = safeName(name, 'PDF-Studio-export.pdf');
  const defaultExt = path.extname(safeFile).replace('.', '') || 'pdf';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save export', defaultPath: safeFile,
    filters: Array.isArray(filters) && filters.length ? filters : [{ name: defaultExt.toUpperCase(), extensions: [defaultExt] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, toBuffer(data));
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('files:save-batch', async (_event, files) => {
  if (!Array.isArray(files) || files.length === 0) return { canceled: true, count: 0 };
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose an export folder', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true, count: 0 };
  const folder = result.filePaths[0];
  const used = new Set();
  let count = 0;
  for (const file of files) {
    let name = safeName(file.name, `export-${count + 1}.bin`);
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    let candidate = name;
    let n = 2;
    while (used.has(candidate.toLowerCase())) { candidate = `${stem} (${n++})${ext}`; }
    used.add(candidate.toLowerCase());
    await fs.writeFile(path.join(folder, candidate), toBuffer(file.data));
    count += 1;
  }
  return { canceled: false, count, folder };
});

