import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ClipboardImageResult,
  hasSupportedImageExtension,
  isTiffFilename,
  type MainProcessTelemetry,
  type PickedDirectoryResult,
  type PickedFileResult,
  type SaveFileResult,
} from '@shared/types';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron';
import { logMain } from './logger';
import { SidecarManager } from './sidecar';

const sidecar = new SidecarManager();
let mainWindow: BrowserWindow | null = null;
let peakRssBytes = process.memoryUsage().rss;
let isQuitting = false;

function sampleTelemetry(): MainProcessTelemetry {
  const currentRss = process.memoryUsage().rss;
  if (currentRss > peakRssBytes) {
    peakRssBytes = currentRss;
  }
  return {
    rssMb: Number((currentRss / (1024 * 1024)).toFixed(1)),
    peakRssMb: Number((peakRssBytes / (1024 * 1024)).toFixed(1)),
    uptimeSeconds: Number(process.uptime().toFixed(1)),
  };
}

function inferMimeFromExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/png';
}

async function buildPickedFileResult(selectedPath: string): Promise<PickedFileResult> {
  const stat = await fsp.stat(selectedPath);
  const name = path.basename(selectedPath);

  if (!isTiffFilename(name)) {
    const img = nativeImage.createFromPath(selectedPath);
    if (!img.isEmpty()) {
      const size = img.getSize();
      const maxDim = Math.max(size.width, size.height);
      const previewImg =
        maxDim > 2048
          ? img.resize(
              size.width >= size.height
                ? { width: 2048, quality: 'better' }
                : { height: 2048, quality: 'better' },
            )
          : img;
      return {
        path: selectedPath,
        name,
        previewDataUrl: previewImg.toDataURL(),
        sizeBytes: stat.size,
        width: size.width,
        height: size.height,
      };
    }

    if (stat.size <= 32 * 1024 * 1024) {
      const buf = await fsp.readFile(selectedPath);
      const mime = inferMimeFromExtension(selectedPath);
      return {
        path: selectedPath,
        name,
        previewDataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        sizeBytes: stat.size,
        width: null,
        height: null,
      };
    }
  }

  return {
    path: selectedPath,
    name,
    previewDataUrl: null,
    sizeBytes: stat.size,
    width: null,
    height: null,
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle('matchtone:get-engine-url', async () => {
    return sidecar.ensureStarted();
  });

  ipcMain.handle('matchtone:get-main-telemetry', (): MainProcessTelemetry => {
    return sampleTelemetry();
  });

  ipcMain.handle('matchtone:pick-image-file', async (): Promise<PickedFileResult | null> => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options: Electron.OpenDialogOptions = {
      title: 'Select Image',
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'bmp'],
        },
      ],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return buildPickedFileResult(result.filePaths[0]);
  });

  ipcMain.handle('matchtone:pick-batch-dir', async (): Promise<PickedDirectoryResult | null> => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options: Electron.OpenDialogOptions = {
      title: 'Select Batch Image Folder',
      properties: ['openDirectory'],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const dirPath = result.filePaths[0];
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const imageNames = entries
      .filter((entry) => entry.isFile() && hasSupportedImageExtension(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    return {
      path: dirPath,
      name: path.basename(dirPath),
      imageCount: imageNames.length,
      imageNames,
    };
  });

  ipcMain.handle('matchtone:pick-output-dir', async (): Promise<string | null> => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options: Electron.OpenDialogOptions = {
      title: 'Select Output Folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(
    'matchtone:save-data-url',
    async (_event, dataUrl: string, defaultFilename: string): Promise<SaveFileResult> => {
      const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
      const options: Electron.SaveDialogOptions = {
        title: 'Save Matched Result',
        defaultPath: defaultFilename,
      };
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return { saved: false, path: null };
      }

      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx === -1) {
        throw new Error('Invalid data URL payload');
      }
      const base64Payload = dataUrl.slice(commaIdx + 1);
      await fsp.writeFile(result.filePath, Buffer.from(base64Payload, 'base64'));
      return { saved: true, path: result.filePath };
    },
  );

  ipcMain.handle(
    'matchtone:read-clipboard-image',
    async (): Promise<ClipboardImageResult | null> => {
      const items = await clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((mime) => mime.startsWith('image/'));
        if (!imgType) {
          continue;
        }
        const payload = await item.getType(imgType);
        if (payload instanceof Blob) {
          const buf = Buffer.from(await payload.arrayBuffer());
          const img = nativeImage.createFromBuffer(buf);
          if (!img.isEmpty()) {
            const size = img.getSize();
            return {
              name: `clipboard_${Date.now()}.png`,
              dataUrl: img.toDataURL(),
              width: size.width,
              height: size.height,
            };
          }
        }
      }
      return null;
    },
  );

  ipcMain.handle(
    'matchtone:reveal-in-folder',
    async (_event, targetPath: string): Promise<boolean> => {
      if (!targetPath || !fs.existsSync(targetPath)) {
        return false;
      }
      const stat = await fsp.stat(targetPath);
      if (stat.isDirectory()) {
        const errMsg = await shell.openPath(targetPath);
        return errMsg === '';
      }
      shell.showItemInFolder(targetPath);
      return true;
    },
  );
}

function createMainWindow(): BrowserWindow {
  const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#09090B',
    title: 'MatchTone',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    const rendererHtml = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
    void win.loadFile(rendererHtml);
  }

  return win;
}

async function gracefulShutdown(reason: string): Promise<void> {
  if (isQuitting) {
    return;
  }
  isQuitting = true;
  logMain('info', 'app.shutdown', { reason });
  await sidecar.stop();
}

process.on('exit', () => {
  sidecar.stopSync();
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void gracefulShutdown(sig).finally(() => {
      app.quit();
    });
  });
}

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    void gracefulShutdown('before-quit').finally(() => {
      app.quit();
    });
  }
});

app.on('will-quit', () => {
  sidecar.stopSync();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

void app.whenReady().then(async () => {
  registerIpcHandlers();
  void sidecar.ensureStarted().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logMain('error', 'sidecar.startup_failed', { message: msg });
  });

  mainWindow = createMainWindow();
  logMain('info', 'app.window_created', { telemetry: sampleTelemetry() });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});
