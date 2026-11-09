import {
  type BatchMatchResponse,
  type ClipboardImageResult,
  type ColorMethodId,
  type EngineErrorPayload,
  type EngineHealthResponse,
  hasSupportedImageExtension,
  isTiffFilename,
  type OutputFormat,
  type PickedFileResult,
  type SingleMatchResponse,
} from '@shared/types';

export interface ImageAsset {
  id: string;
  name: string;
  file: File | null;
  localPath: string | null;
  previewUrl: string | null;
  revokeOnCleanup: boolean;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  isTiff: boolean;
  isUnreadable: boolean;
  fileSignature: string | null;
}

export class EngineRequestError extends Error {
  public readonly status: number;
  public readonly failureCode: string | null;

  constructor(message: string, status: number, failureCode: string | null = null) {
    super(message);
    this.name = 'EngineRequestError';
    this.status = status;
    this.failureCode = failureCode;
  }
}

export async function resolveInitialEngineUrl(): Promise<string> {
  if (window.matchtone) {
    try {
      const desktopUrl = await window.matchtone.getEngineUrl();
      if (desktopUrl) {
        return desktopUrl.replace(/\/+$/, '');
      }
    } catch {
      // Fallback to VITE_ENGINE_URL or localhost default.
    }
  }
  const envUrl = import.meta.env.VITE_ENGINE_URL;
  if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:8765';
}

async function parseErrorResponse(res: Response): Promise<EngineRequestError> {
  let message = `Request failed (${res.status})`;
  let failureCode: string | null = null;
  try {
    const body = (await res.json()) as EngineErrorPayload;
    if (typeof body.detail === 'string' && body.detail.trim().length > 0) {
      message = body.detail;
    } else if (Array.isArray(body.detail) && body.detail.length > 0) {
      const firstMsg = body.detail[0]?.msg;
      if (firstMsg) {
        message = firstMsg;
      }
    }
    if (typeof body.failure_code === 'string' && body.failure_code.trim().length > 0) {
      failureCode = body.failure_code;
    }
  } catch {
    // Non-JSON response body.
  }
  return new EngineRequestError(message, res.status, failureCode);
}

export async function fetchEngineHealth(baseUrl: string): Promise<EngineHealthResponse> {
  const res = await fetch(`${baseUrl}/health`, {
    method: 'GET',
    signal: AbortSignal.timeout(3500),
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as EngineHealthResponse;
}

export interface SingleMatchParams {
  baseUrl: string;
  source: ImageAsset;
  reference: ImageAsset;
  method: ColorMethodId;
  intensity: number;
  outputFormat: OutputFormat;
  outputDir: string | null;
  saveToDisk: boolean;
  filenameSuffix?: string;
  signal?: AbortSignal;
}

export async function runSingleMatch(params: SingleMatchParams): Promise<SingleMatchResponse> {
  const form = new FormData();
  if (params.source.localPath) {
    form.append('src_path', params.source.localPath);
  } else if (params.source.file) {
    form.append('src_file', params.source.file, params.source.name);
    form.append('source_name', params.source.name);
  }

  if (params.reference.localPath) {
    form.append('ref_path', params.reference.localPath);
  } else if (params.reference.file) {
    form.append('ref_file', params.reference.file, params.reference.name);
  }

  form.append('method', params.method);
  form.append('intensity', String(params.intensity));
  form.append('output_format', params.outputFormat);
  if (params.filenameSuffix && params.filenameSuffix.trim().length > 0) {
    form.append('filename_suffix', params.filenameSuffix.trim());
  }

  const trimmedDir = params.outputDir?.trim() ?? '';
  if (trimmedDir.length > 0) {
    form.append('output_dir', trimmedDir);
  }
  form.append('save_to_disk', params.saveToDisk ? 'true' : 'false');

  const res = await fetch(`${params.baseUrl}/v1/match/single`, {
    method: 'POST',
    body: form,
    signal: params.signal,
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as SingleMatchResponse;
}

export interface BatchMatchParams {
  baseUrl: string;
  batchDirPath: string | null;
  batchFiles: ImageAsset[];
  reference: ImageAsset;
  method: ColorMethodId;
  intensity: number;
  outputFormat: OutputFormat;
  outputDir: string | null;
  filenameSuffix?: string;
}

export async function runBatchMatch(params: BatchMatchParams): Promise<BatchMatchResponse> {
  const form = new FormData();

  if (params.reference.localPath) {
    form.append('ref_path', params.reference.localPath);
  } else if (params.reference.file) {
    form.append('ref_file', params.reference.file, params.reference.name);
  }

  if (params.batchDirPath) {
    form.append('src_dir', params.batchDirPath);
  } else {
    for (const item of params.batchFiles) {
      if (item.file) {
        form.append('src_files', item.file, item.name);
      }
    }
  }

  form.append('method', params.method);
  form.append('intensity', String(params.intensity));
  form.append('output_format', params.outputFormat);
  if (params.filenameSuffix && params.filenameSuffix.trim().length > 0) {
    form.append('filename_suffix', params.filenameSuffix.trim());
  }

  const trimmedDir = params.outputDir?.trim() ?? '';
  if (trimmedDir.length > 0) {
    form.append('output_dir', trimmedDir);
  }

  const res = await fetch(`${params.baseUrl}/v1/match/batch`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as BatchMatchResponse;
}

export async function sendClientLog(
  baseUrl: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    await fetch(`${baseUrl}/v1/client-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, context }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Telemetry logging must never interrupt UI flow.
  }
}

export function cleanupImageAsset(asset: ImageAsset | null): void {
  if (asset?.revokeOnCleanup && asset.previewUrl) {
    URL.revokeObjectURL(asset.previewUrl);
  }
}

function probeImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = url;
  });
}

function createAssetId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getFileSignature(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function fileToImageAsset(file: File): Promise<ImageAsset> {
  const localPath = window.matchtone ? window.matchtone.getPathForFile(file) || null : null;
  const signature = getFileSignature(file);
  if (isTiffFilename(file.name)) {
    return {
      id: createAssetId(),
      name: file.name,
      file,
      localPath,
      previewUrl: null,
      revokeOnCleanup: false,
      sizeBytes: file.size,
      width: null,
      height: null,
      isTiff: true,
      isUnreadable: false,
      fileSignature: signature,
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const dims = await probeImageDimensions(objectUrl);
  if (!dims) {
    URL.revokeObjectURL(objectUrl);
    return {
      id: createAssetId(),
      name: file.name,
      file,
      localPath,
      previewUrl: null,
      revokeOnCleanup: false,
      sizeBytes: file.size,
      width: null,
      height: null,
      isTiff: false,
      isUnreadable: true,
      fileSignature: signature,
    };
  }

  return {
    id: createAssetId(),
    name: file.name,
    file,
    localPath,
    previewUrl: objectUrl,
    revokeOnCleanup: true,
    sizeBytes: file.size,
    width: dims.width,
    height: dims.height,
    isTiff: false,
    isUnreadable: false,
    fileSignature: signature,
  };
}

export function pickedFileToImageAsset(picked: PickedFileResult): ImageAsset {
  const tiff = isTiffFilename(picked.name);
  return {
    id: createAssetId(),
    name: picked.name,
    file: null,
    localPath: picked.path,
    previewUrl: picked.previewDataUrl,
    revokeOnCleanup: false,
    sizeBytes: picked.sizeBytes,
    width: picked.width,
    height: picked.height,
    isTiff: tiff,
    isUnreadable: !tiff && !picked.previewDataUrl,
    fileSignature: `${picked.path}:${picked.sizeBytes}`,
  };
}

export async function clipboardToImageAsset(clip: ClipboardImageResult): Promise<ImageAsset> {
  const res = await fetch(clip.dataUrl);
  const blob = await res.blob();
  const file = new File([blob], clip.name, { type: 'image/png' });
  return {
    id: createAssetId(),
    name: clip.name,
    file,
    localPath: null,
    previewUrl: clip.dataUrl,
    revokeOnCleanup: false,
    sizeBytes: file.size,
    width: clip.width,
    height: clip.height,
    isTiff: false,
    isUnreadable: false,
    fileSignature: getFileSignature(file),
  };
}

export function triggerBrowserDownload(dataUrl: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function extractBasename(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || pathValue;
}

async function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const collected: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      break;
    }
    collected.push(...batch);
  }
  return collected;
}

async function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    return [file];
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const entries = await readAllDirectoryEntries(dirEntry.createReader());
    const nested = await Promise.all(entries.map((child) => collectFilesFromEntry(child)));
    return nested.flat();
  }
  return [];
}

export async function extractFilesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length > 0) {
    const nested = await Promise.all(entries.map((entry) => collectFilesFromEntry(entry)));
    const allFiles = nested.flat();
    if (allFiles.length > 0) {
      return allFiles;
    }
  }

  return Array.from(dt.files ?? []);
}

export function isLikelyImageFile(file: File): boolean {
  if (hasSupportedImageExtension(file.name)) {
    return true;
  }
  return file.type.startsWith('image/');
}
