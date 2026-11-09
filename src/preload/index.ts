import type {
  ClipboardImageResult,
  MainProcessTelemetry,
  MatchToneDesktopBridge,
  PickedDirectoryResult,
  PickedFileResult,
  SaveFileResult,
} from '@shared/types';
import { contextBridge, ipcRenderer, webUtils } from 'electron';

const matchtoneBridge: MatchToneDesktopBridge = {
  platform: process.platform,
  getEngineUrl: (): Promise<string> => ipcRenderer.invoke('matchtone:get-engine-url'),
  getMainProcessTelemetry: (): Promise<MainProcessTelemetry> =>
    ipcRenderer.invoke('matchtone:get-main-telemetry'),
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  pickImageFile: (): Promise<PickedFileResult | null> =>
    ipcRenderer.invoke('matchtone:pick-image-file'),
  pickBatchDirectory: (): Promise<PickedDirectoryResult | null> =>
    ipcRenderer.invoke('matchtone:pick-batch-dir'),
  pickOutputDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('matchtone:pick-output-dir'),
  saveDataUrlToFile: (dataUrl: string, defaultFilename: string): Promise<SaveFileResult> =>
    ipcRenderer.invoke('matchtone:save-data-url', dataUrl, defaultFilename),
  readClipboardImage: (): Promise<ClipboardImageResult | null> =>
    ipcRenderer.invoke('matchtone:read-clipboard-image'),
  revealInFolder: (targetPath: string): Promise<boolean> =>
    ipcRenderer.invoke('matchtone:reveal-in-folder', targetPath),
};

contextBridge.exposeInMainWorld('matchtone', matchtoneBridge);
