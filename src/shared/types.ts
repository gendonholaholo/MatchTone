export const APP_VERSION = '0.1.3';

export type ColorMethodId = 'hm-mvgd-hm' | 'hm-mkl-hm' | 'mkl' | 'mvgd' | 'reinhard' | 'hm';

export const DEFAULT_METHOD: ColorMethodId = 'hm-mvgd-hm';

export const OUTPUT_FORMATS = ['png', 'jpg', 'webp', 'tiff'] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'png';

export const DEFAULT_STRENGTH = 100;

export const DEFAULT_FILENAME_SUFFIX = '_matchtone';

export const ACCEPTED_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.tiff',
  '.tif',
  '.bmp',
] as const;

export const ACCEPTED_FILE_INPUT = '.png,.jpg,.jpeg,.webp,.tiff,.tif,.bmp,image/*';

export interface EngineMemoryStats {
  rss_mb: number;
  peak_rss_mb: number;
}

export interface EngineLatencyStats {
  count: number;
  p50_ms: number;
  p95_ms: number;
  last_ms: number;
}

export interface EngineHealthResponse {
  status: string;
  ready: boolean;
  version: string;
  engine: string;
  engine_version: string;
  methods: ColorMethodId[];
  warmup_ms: number;
  uptime_seconds: number;
  memory: EngineMemoryStats;
  latency: EngineLatencyStats;
}

export interface SingleMatchBreakdown {
  decode_ms: number;
  transfer_ms: number;
  encode_ms: number;
  total_ms: number;
}

export interface SingleMatchResponse {
  preview_data_url: string;
  download_data_url: string;
  mime_type: string;
  output_path: string | null;
  suggested_filename: string;
  width: number;
  height: number;
  format: OutputFormat;
  method: ColorMethodId;
  intensity: number;
  breakdown_ms: SingleMatchBreakdown;
  memory: EngineMemoryStats;
  latency: EngineLatencyStats;
}

export interface BatchMatchItem {
  filename: string;
  status: 'ok' | 'error';
  output_path: string | null;
  output_filename: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number;
  error: string | null;
  preview_data_url?: string | null;
  download_data_url?: string | null;
}

export interface BatchMatchResponse {
  output_dir: string | null;
  zip_data_url: string | null;
  zip_filename: string | null;
  method: ColorMethodId;
  intensity: number;
  format: OutputFormat;
  total_count: number;
  succeeded_count: number;
  failed_count: number;
  total_ms: number;
  items: BatchMatchItem[];
  memory: EngineMemoryStats;
  latency: EngineLatencyStats;
}

export interface EngineErrorPayload {
  detail?: string | Array<{ msg?: string }>;
  failure_code?: string;
}

export interface MainProcessTelemetry {
  rssMb: number;
  peakRssMb: number;
  uptimeSeconds: number;
}

export interface PickedFileResult {
  path: string;
  name: string;
  previewDataUrl: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface PickedDirectoryResult {
  path: string;
  name: string;
  imageCount: number;
  imageNames: string[];
}

export interface ClipboardImageResult {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface SaveFileResult {
  saved: boolean;
  path: string | null;
}

export interface MatchToneDesktopBridge {
  platform: string;
  getEngineUrl: () => Promise<string>;
  getMainProcessTelemetry: () => Promise<MainProcessTelemetry>;
  getPathForFile: (file: File) => string;
  pickImageFile: () => Promise<PickedFileResult | null>;
  pickBatchDirectory: () => Promise<PickedDirectoryResult | null>;
  pickOutputDirectory: () => Promise<string | null>;
  saveDataUrlToFile: (dataUrl: string, defaultFilename: string) => Promise<SaveFileResult>;
  readClipboardImage: () => Promise<ClipboardImageResult | null>;
  revealInFolder: (targetPath: string) => Promise<boolean>;
}

export function hasSupportedImageExtension(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  return ACCEPTED_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isTiffFilename(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  return lower.endsWith('.tif') || lower.endsWith('.tiff');
}
