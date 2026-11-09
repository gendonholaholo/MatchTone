import {
  ACCEPTED_FILE_INPUT,
  type BatchMatchResponse,
  DEFAULT_FILENAME_SUFFIX,
  DEFAULT_METHOD,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_STRENGTH,
  type EngineHealthResponse,
  hasSupportedImageExtension,
  type MainProcessTelemetry,
  type OutputFormat,
  type PickedDirectoryResult,
  type SingleMatchResponse,
} from '@shared/types';
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle2,
  ClipboardPaste,
  Columns2,
  Download,
  FolderOpen,
  Images,
  Loader2,
  Palette,
  PanelLeftOpen,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { BatchStage } from './components/BatchStage';
import { BeforeAfterSlider } from './components/BeforeAfterSlider';
import { DropzoneCard } from './components/DropzoneCard';
import { Sidebar, type SidebarTab } from './components/Sidebar';
import {
  cleanupImageAsset,
  clipboardToImageAsset,
  EngineRequestError,
  fetchEngineHealth,
  fileToImageAsset,
  getFileSignature,
  type ImageAsset,
  isLikelyImageFile,
  pickedFileToImageAsset,
  resolveInitialEngineUrl,
  runBatchMatch,
  runSingleMatch,
  sendClientLog,
  triggerBrowserDownload,
} from './lib/api';

interface UiAlert {
  kind: 'error' | 'success';
  message: string;
  code?: string | null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export function App() {
  const isDesktop = typeof window !== 'undefined' && Boolean(window.matchtone);
  const isMacDesktop = isDesktop && window.matchtone?.platform === 'darwin';

  const [engineUrl, setEngineUrl] = useState<string>('http://127.0.0.1:8765');
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);
  const [health, setHealth] = useState<EngineHealthResponse | null>(null);
  const [mainTelemetry, setMainTelemetry] = useState<MainProcessTelemetry | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<SidebarTab>('match');
  const [batchMode, setBatchMode] = useState<boolean>(false);

  const [source, setSource] = useState<ImageAsset | null>(null);
  const [reference, setReference] = useState<ImageAsset | null>(null);
  const [activePasteTarget, setActivePasteTarget] = useState<'source' | 'reference'>('source');

  const [batchFiles, setBatchFiles] = useState<ImageAsset[]>([]);
  const [batchDir, setBatchDir] = useState<PickedDirectoryResult | null>(null);

  const [strength, setStrength] = useState<number>(DEFAULT_STRENGTH);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(DEFAULT_OUTPUT_FORMAT);
  const [filenameSuffix, setFilenameSuffix] = useState<string>(DEFAULT_FILENAME_SUFFIX);
  const [outputDir, setOutputDir] = useState<string>('');
  const [autoSaveDesktop, setAutoSaveDesktop] = useState<boolean>(true);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isAutoUpdating, setIsAutoUpdating] = useState<boolean>(false);
  const [singleResult, setSingleResult] = useState<SingleMatchResponse | null>(null);
  const [singleCanvasView, setSingleCanvasView] = useState<'inputs' | 'result'>('inputs');
  const [batchResult, setBatchResult] = useState<BatchMatchResponse | null>(null);
  const [alert, setAlert] = useState<UiAlert | null>(null);

  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const batchFilesInputRef = useRef<HTMLInputElement | null>(null);
  const batchFolderInputRef = useRef<HTMLInputElement | null>(null);

  const alertBannerRef = useRef<HTMLDivElement | null>(null);
  const singleResultStageRef = useRef<HTMLDivElement | null>(null);
  const batchResultsRef = useRef<HTMLElement | null>(null);

  const batchFilesRef = useRef<ImageAsset[]>([]);
  batchFilesRef.current = batchFiles;

  const autoUpdateAbortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef<number>(0);
  const lastAppliedSuffixRef = useRef<string>(DEFAULT_FILENAME_SUFFIX);

  const cancelPendingAutoUpdate = useCallback(() => {
    requestSeqRef.current += 1;
    if (autoUpdateAbortRef.current) {
      autoUpdateAbortRef.current.abort();
      autoUpdateAbortRef.current = null;
    }
    setIsAutoUpdating(false);
  }, []);

  const scrollElementOnMobile = useCallback((el: HTMLElement | null) => {
    if (typeof window === 'undefined' || window.innerWidth >= 1024 || !el) {
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const setBatchFolderRef = useCallback((node: HTMLInputElement | null) => {
    batchFolderInputRef.current = node;
    if (node) {
      node.setAttribute('webkitdirectory', '');
      node.setAttribute('directory', '');
    }
  }, []);

  const refreshTelemetry = useCallback(async (targetUrl: string) => {
    try {
      const data = await fetchEngineHealth(targetUrl);
      setHealth(data);
      setEngineOnline(Boolean(data.ready));
    } catch {
      setEngineOnline(false);
    }

    if (window.matchtone) {
      try {
        const mainStats = await window.matchtone.getMainProcessTelemetry();
        setMainTelemetry(mainStats);
      } catch {
        // Ignore desktop telemetry error.
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    void resolveInitialEngineUrl().then((resolvedUrl) => {
      if (cancelled) return;
      setEngineUrl(resolvedUrl);
      void refreshTelemetry(resolvedUrl);
      intervalId = setInterval(() => {
        void refreshTelemetry(resolvedUrl);
      }, 5000);
    });

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [refreshTelemetry]);

  const replaceSourceAsset = useCallback(
    (nextAsset: ImageAsset | null) => {
      cancelPendingAutoUpdate();
      setSource((prev) => {
        if (prev && prev.id !== nextAsset?.id) {
          cleanupImageAsset(prev);
        }
        return nextAsset;
      });
      setSingleResult(null);
      setSingleCanvasView('inputs');
    },
    [cancelPendingAutoUpdate],
  );

  const replaceReferenceAsset = useCallback(
    (nextAsset: ImageAsset | null) => {
      cancelPendingAutoUpdate();
      setReference((prev) => {
        if (prev && prev.id !== nextAsset?.id) {
          cleanupImageAsset(prev);
        }
        return nextAsset;
      });
      setSingleResult(null);
      setBatchResult(null);
      setSingleCanvasView('inputs');
    },
    [cancelPendingAutoUpdate],
  );

  const handleSingleFileAssigned = useCallback(
    async (slot: 'source' | 'reference', file: File) => {
      if (!isLikelyImageFile(file)) {
        setAlert({
          kind: 'error',
          message: `Unsupported format: ${file.name}. Select PNG, JPG, WEBP, TIFF, or BMP.`,
          code: 'UNSUPPORTED_FILE',
        });
        return;
      }
      setAlert(null);
      const asset = await fileToImageAsset(file);
      if (slot === 'source') {
        replaceSourceAsset(asset);
        setReference((currRef) => {
          if (!currRef) {
            setActivePasteTarget('reference');
          }
          return currRef;
        });
      } else {
        replaceReferenceAsset(asset);
      }
    },
    [replaceReferenceAsset, replaceSourceAsset],
  );

  const appendBatchFiles = useCallback(async (files: File[]) => {
    const valid = files.filter((f) => hasSupportedImageExtension(f.name) || isLikelyImageFile(f));
    if (valid.length === 0) {
      setAlert({
        kind: 'error',
        message: 'No supported images found. Select PNG, JPG, WEBP, TIFF, or BMP files.',
        code: 'EMPTY_BATCH',
      });
      return;
    }

    const seenSignatures = new Set<string>(
      batchFilesRef.current
        .map((item) => item.fileSignature)
        .filter((sig): sig is string => Boolean(sig)),
    );
    const uniqueIncoming: File[] = [];
    for (const file of valid) {
      const sig = getFileSignature(file);
      if (seenSignatures.has(sig)) {
        continue;
      }
      seenSignatures.add(sig);
      uniqueIncoming.push(file);
    }

    setAlert(null);
    setBatchDir(null);
    if (uniqueIncoming.length === 0) {
      return;
    }
    setBatchResult(null);
    const created = await Promise.all(uniqueIncoming.map((file) => fileToImageAsset(file)));
    setBatchFiles((prev) => {
      const existingSigs = new Set<string>(
        prev.map((item) => item.fileSignature).filter((sig): sig is string => Boolean(sig)),
      );
      const fresh: ImageAsset[] = [];
      for (const item of created) {
        if (item.fileSignature && existingSigs.has(item.fileSignature)) {
          cleanupImageAsset(item);
          continue;
        }
        if (item.fileSignature) {
          existingSigs.add(item.fileSignature);
        }
        fresh.push(item);
      }
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }, []);

  // Global Cmd/Ctrl+V Clipboard Image Paste with editable-element & busy guards
  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      if (isProcessing) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (imageItem) {
        const pastedFile = imageItem.getAsFile();
        if (pastedFile) {
          event.preventDefault();
          const namedFile = new File(
            [pastedFile],
            pastedFile.name && pastedFile.name !== 'image.png'
              ? pastedFile.name
              : `pasted_${Date.now()}.png`,
            { type: pastedFile.type || 'image/png' },
          );
          if (batchMode) {
            if (activePasteTarget === 'reference' || !reference) {
              await handleSingleFileAssigned('reference', namedFile);
            } else {
              await appendBatchFiles([namedFile]);
            }
          } else {
            await handleSingleFileAssigned(activePasteTarget, namedFile);
          }
          return;
        }
      }

      if (window.matchtone) {
        const clip = await window.matchtone.readClipboardImage();
        if (clip) {
          event.preventDefault();
          const asset = await clipboardToImageAsset(clip);
          setAlert(null);
          if (batchMode) {
            if (activePasteTarget === 'reference' || !reference) {
              replaceReferenceAsset(asset);
            } else {
              setBatchDir(null);
              setBatchResult(null);
              setBatchFiles((prev) => [...prev, asset]);
            }
          } else if (activePasteTarget === 'source') {
            replaceSourceAsset(asset);
            if (!reference) {
              setActivePasteTarget('reference');
            }
          } else {
            replaceReferenceAsset(asset);
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [
    activePasteTarget,
    appendBatchFiles,
    batchMode,
    handleSingleFileAssigned,
    isProcessing,
    reference,
    replaceReferenceAsset,
    replaceSourceAsset,
  ]);

  // Live Auto-Update when adjusting Strength (150ms debounce), Format (immediate), or Suffix
  useEffect(() => {
    if (
      batchMode ||
      isProcessing ||
      !singleResult ||
      !source ||
      !reference ||
      source.isUnreadable ||
      reference.isUnreadable
    ) {
      return;
    }

    const normalizedSuffix = filenameSuffix.trim() || DEFAULT_FILENAME_SUFFIX;
    const formatChanged = singleResult.format !== outputFormat;
    const strengthChanged = Math.round(singleResult.intensity) !== strength;
    const suffixChanged = lastAppliedSuffixRef.current !== normalizedSuffix;

    if (!formatChanged && !strengthChanged && !suffixChanged) {
      return;
    }

    const delayMs = formatChanged ? 0 : 150;
    const timer = setTimeout(() => {
      if (autoUpdateAbortRef.current) {
        autoUpdateAbortRef.current.abort();
      }
      const controller = new AbortController();
      autoUpdateAbortRef.current = controller;
      const seq = ++requestSeqRef.current;
      setIsAutoUpdating(true);

      const shouldSaveToDisk =
        isDesktop && autoSaveDesktop && Boolean(outputDir.trim() || source.localPath);

      void runSingleMatch({
        baseUrl: engineUrl,
        source,
        reference,
        method: DEFAULT_METHOD,
        intensity: strength,
        outputFormat,
        outputDir: isDesktop ? outputDir.trim() || null : null,
        saveToDisk: shouldSaveToDisk,
        filenameSuffix: normalizedSuffix,
        signal: controller.signal,
      })
        .then((res) => {
          if (seq !== requestSeqRef.current) {
            return;
          }
          lastAppliedSuffixRef.current = normalizedSuffix;
          setSingleResult(res);
          setEngineOnline(true);
          setAlert(null);
          void refreshTelemetry(engineUrl);
        })
        .catch((err: unknown) => {
          if (isAbortError(err) || seq !== requestSeqRef.current) {
            return;
          }
          if (err instanceof EngineRequestError) {
            setAlert({
              kind: 'error',
              message: err.message,
              code: err.failureCode,
            });
          }
        })
        .finally(() => {
          if (seq === requestSeqRef.current) {
            setIsAutoUpdating(false);
          }
        });
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [
    autoSaveDesktop,
    batchMode,
    engineUrl,
    filenameSuffix,
    isDesktop,
    isProcessing,
    outputDir,
    outputFormat,
    reference,
    refreshTelemetry,
    singleResult,
    source,
    strength,
  ]);

  const handleSelectSource = async () => {
    setActivePasteTarget('source');
    if (window.matchtone) {
      const picked = await window.matchtone.pickImageFile();
      if (picked) {
        setAlert(null);
        replaceSourceAsset(pickedFileToImageAsset(picked));
        if (!reference) {
          setActivePasteTarget('reference');
        }
      }
      return;
    }
    sourceInputRef.current?.click();
  };

  const handleSelectReference = async () => {
    setActivePasteTarget('reference');
    if (window.matchtone) {
      const picked = await window.matchtone.pickImageFile();
      if (picked) {
        setAlert(null);
        replaceReferenceAsset(pickedFileToImageAsset(picked));
      }
      return;
    }
    referenceInputRef.current?.click();
  };

  const handleSelectBatchFiles = () => {
    setActivePasteTarget('source');
    batchFilesInputRef.current?.click();
  };

  const handleSelectBatchFolder = async () => {
    setActivePasteTarget('source');
    if (window.matchtone) {
      const dir = await window.matchtone.pickBatchDirectory();
      if (!dir) {
        return;
      }
      if (dir.imageCount === 0) {
        setAlert({
          kind: 'error',
          message: `Folder "${dir.name}" contains no supported images.`,
          code: 'EMPTY_BATCH',
        });
        return;
      }
      setAlert(null);
      setBatchFiles((prev) => {
        for (const item of prev) cleanupImageAsset(item);
        return [];
      });
      setBatchDir(dir);
      setBatchResult(null);
      return;
    }
    batchFolderInputRef.current?.click();
  };

  const handleSourceInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      await handleSingleFileAssigned('source', file);
    }
  };

  const handleReferenceInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      await handleSingleFileAssigned('reference', file);
    }
  };

  const handleBatchFilesInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length > 0) {
      await appendBatchFiles(files);
    }
  };

  const handleBatchFolderInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((f) =>
      hasSupportedImageExtension(f.name),
    );
    event.target.value = '';
    if (files.length === 0) {
      setAlert({
        kind: 'error',
        message: 'Selected folder contains no supported images.',
        code: 'EMPTY_BATCH',
      });
      return;
    }
    await appendBatchFiles(files);
  };

  const handleRemoveBatchFile = (id: string) => {
    setBatchFiles((prev) => {
      const target = prev.find((item) => item.id === id) ?? null;
      cleanupImageAsset(target);
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleClearBatch = () => {
    setBatchFiles((prev) => {
      for (const item of prev) cleanupImageAsset(item);
      return [];
    });
    setBatchDir(null);
    setBatchResult(null);
  };

  const handleSwapSourceReference = () => {
    if (!source || !reference || isProcessing) {
      return;
    }
    cancelPendingAutoUpdate();
    const prevSource = source;
    const prevRef = reference;
    setSource(prevRef);
    setReference(prevSource);
    setSingleResult(null);
    setSingleCanvasView('inputs');
    setAlert(null);
  };

  const handlePickOutputDir = async () => {
    if (!window.matchtone) {
      return;
    }
    const dir = await window.matchtone.pickOutputDirectory();
    if (dir) {
      setOutputDir(dir);
    }
  };

  const handleRunMatch = async () => {
    if (isProcessing) {
      return;
    }
    cancelPendingAutoUpdate();
    const seq = ++requestSeqRef.current;
    const normalizedSuffix = filenameSuffix.trim() || DEFAULT_FILENAME_SUFFIX;
    setAlert(null);
    setIsProcessing(true);

    try {
      if (batchMode) {
        const hasQueue = batchDir ? batchDir.imageCount > 0 : batchFiles.length > 0;
        if (!hasQueue || !reference) {
          return;
        }
        const res = await runBatchMatch({
          baseUrl: engineUrl,
          batchDirPath: batchDir?.path ?? null,
          batchFiles,
          reference,
          method: DEFAULT_METHOD,
          intensity: strength,
          outputFormat,
          outputDir: isDesktop ? outputDir.trim() || null : null,
          filenameSuffix: normalizedSuffix,
        });
        if (seq !== requestSeqRef.current) {
          return;
        }
        setBatchResult(res);
        setEngineOnline(true);
        requestAnimationFrame(() => {
          scrollElementOnMobile(batchResultsRef.current);
        });
        void sendClientLog(engineUrl, 'info', 'batch_match.completed', {
          method: res.method,
          total_count: res.total_count,
          succeeded_count: res.succeeded_count,
          total_ms: res.total_ms,
        });
      } else {
        if (!source || !reference) {
          return;
        }
        const shouldSaveToDisk =
          isDesktop && autoSaveDesktop && Boolean(outputDir.trim() || source.localPath);
        const res = await runSingleMatch({
          baseUrl: engineUrl,
          source,
          reference,
          method: DEFAULT_METHOD,
          intensity: strength,
          outputFormat,
          outputDir: isDesktop ? outputDir.trim() || null : null,
          saveToDisk: shouldSaveToDisk,
          filenameSuffix: normalizedSuffix,
        });
        if (seq !== requestSeqRef.current) {
          return;
        }
        lastAppliedSuffixRef.current = normalizedSuffix;
        setSingleResult(res);
        setSingleCanvasView('result');
        setEngineOnline(true);
        requestAnimationFrame(() => {
          scrollElementOnMobile(singleResultStageRef.current);
        });
        void sendClientLog(engineUrl, 'info', 'single_match.completed', {
          method: res.method,
          format: res.format,
          total_ms: res.breakdown_ms.total_ms,
        });
      }
      void refreshTelemetry(engineUrl);
    } catch (err: unknown) {
      if (seq !== requestSeqRef.current) {
        return;
      }
      if (err instanceof EngineRequestError) {
        setAlert({
          kind: 'error',
          message: err.message,
          code: err.failureCode,
        });
        requestAnimationFrame(() => {
          scrollElementOnMobile(alertBannerRef.current);
        });
        void sendClientLog(engineUrl, 'warn', 'match.request_failed', {
          status: err.status,
          failureCode: err.failureCode,
          message: err.message,
        });
      } else {
        setEngineOnline(false);
        setAlert({
          kind: 'error',
          message: `Color engine unreachable at ${engineUrl}. Verify the sidecar is running.`,
          code: 'ENGINE_OFFLINE',
        });
        requestAnimationFrame(() => {
          scrollElementOnMobile(alertBannerRef.current);
        });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveSingleResult = async () => {
    if (!singleResult) {
      return;
    }
    if (window.matchtone) {
      try {
        const saved = await window.matchtone.saveDataUrlToFile(
          singleResult.download_data_url,
          singleResult.suggested_filename,
        );
        if (saved.saved && saved.path) {
          setAlert({
            kind: 'success',
            message: `Saved ${saved.path}`,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to save output file';
        setAlert({ kind: 'error', message: msg });
      }
      return;
    }

    triggerBrowserDownload(singleResult.download_data_url, singleResult.suggested_filename);
  };

  const handleDownloadBatchZip = () => {
    if (!batchResult?.zip_data_url) {
      return;
    }
    const filename = batchResult.zip_filename || `matchtone_batch_${batchResult.method}.zip`;
    triggerBrowserDownload(batchResult.zip_data_url, filename);
  };

  const handleRevealPath = async (targetPath: string) => {
    if (window.matchtone) {
      await window.matchtone.revealInFolder(targetPath);
    }
  };

  const handleResetDefaults = () => {
    setStrength(DEFAULT_STRENGTH);
    setOutputFormat(DEFAULT_OUTPUT_FORMAT);
    setFilenameSuffix(DEFAULT_FILENAME_SUFFIX);
    setOutputDir('');
    setAutoSaveDesktop(true);
  };

  const handleResetAll = () => {
    cancelPendingAutoUpdate();
    replaceSourceAsset(null);
    replaceReferenceAsset(null);
    handleClearBatch();
    setBatchMode(false);
    setActiveTab('match');
    setStrength(DEFAULT_STRENGTH);
    setOutputFormat(DEFAULT_OUTPUT_FORMAT);
    setFilenameSuffix(DEFAULT_FILENAME_SUFFIX);
    lastAppliedSuffixRef.current = DEFAULT_FILENAME_SUFFIX;
    setOutputDir('');
    setAutoSaveDesktop(true);
    setAlert(null);
    setActivePasteTarget('source');
  };

  const canSwapSingle = !batchMode && Boolean(source) && Boolean(reference) && !isProcessing;
  const hasBatchSource = batchDir ? batchDir.imageCount > 0 : batchFiles.length > 0;
  const canRunCurrent = batchMode
    ? hasBatchSource && Boolean(reference) && !isProcessing && engineOnline !== false
    : Boolean(source) && Boolean(reference) && !isProcessing && engineOnline !== false;

  const expandSidebarButton = sidebarCollapsed ? (
    <button
      type="button"
      onClick={() => setSidebarCollapsed(false)}
      aria-label="Expand sidebar"
      title="Expand sidebar"
      className="hidden items-center gap-1.5 rounded-xl border border-zinc-700 bg-[#18181B] px-3 py-1.5 text-xs font-semibold text-zinc-100 shadow-sm transition hover:border-[#722ED1] hover:bg-[#722ED1]/20 hover:text-[#FAF5FF] md:inline-flex"
    >
      <PanelLeftOpen className="h-3.5 w-3.5 text-[#A855F7]" />
      <span>Sidebar</span>
    </button>
  ) : null;

  return (
    <div className="flex min-h-screen w-full max-w-full flex-col overflow-x-hidden bg-[#09090B] text-zinc-100 md:h-screen md:flex-row md:overflow-hidden">
      {/* Hidden File Inputs for Dual Web + Electron Compatibility */}
      <input
        ref={sourceInputRef}
        type="file"
        accept={ACCEPTED_FILE_INPUT}
        onChange={handleSourceInputChange}
        aria-label="Upload source photo"
        className="hidden"
      />
      <input
        ref={referenceInputRef}
        type="file"
        accept={ACCEPTED_FILE_INPUT}
        onChange={handleReferenceInputChange}
        aria-label="Upload reference photo"
        className="hidden"
      />
      <input
        ref={batchFilesInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_INPUT}
        onChange={handleBatchFilesInputChange}
        aria-label="Upload batch photos"
        className="hidden"
      />
      <input
        ref={setBatchFolderRef}
        type="file"
        multiple
        onChange={handleBatchFolderInputChange}
        aria-label="Upload batch folder"
        className="hidden"
      />

      {/* Left Sidebar (Desktop collapsible, Mobile stacked) */}
      <div className={sidebarCollapsed ? 'flex md:hidden' : 'flex'}>
        <Sidebar
          isDesktop={isDesktop}
          isMacDesktop={isMacDesktop}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onCollapse={() => setSidebarCollapsed(true)}
          engineOnline={engineOnline}
          health={health}
          mainTelemetry={mainTelemetry}
          onRefreshHealth={() => {
            void refreshTelemetry(engineUrl);
          }}
          batchMode={batchMode}
          onToggleBatchMode={(next) => {
            setBatchMode(next);
            setAlert(null);
          }}
          source={source}
          reference={reference}
          batchFiles={batchFiles}
          batchDir={batchDir}
          strength={strength}
          onStrengthChange={setStrength}
          outputFormat={outputFormat}
          onOutputFormatChange={setOutputFormat}
          filenameSuffix={filenameSuffix}
          onFilenameSuffixChange={setFilenameSuffix}
          outputDir={outputDir}
          onPickOutputDir={() => {
            void handlePickOutputDir();
          }}
          onClearOutputDir={() => setOutputDir('')}
          autoSaveDesktop={autoSaveDesktop}
          onToggleAutoSaveDesktop={setAutoSaveDesktop}
          isProcessing={isProcessing}
          isAutoUpdating={isAutoUpdating}
          singleResult={singleResult}
          batchResult={batchResult}
          onSelectSource={() => {
            void handleSelectSource();
          }}
          onClearSource={() => replaceSourceAsset(null)}
          onSelectBatchFiles={handleSelectBatchFiles}
          onSelectBatchFolder={() => {
            void handleSelectBatchFolder();
          }}
          onClearBatch={handleClearBatch}
          onSelectReference={() => {
            void handleSelectReference();
          }}
          onClearReference={() => replaceReferenceAsset(null)}
          onSwapSourceReference={handleSwapSourceReference}
          onRunMatch={() => {
            void handleRunMatch();
          }}
          onSaveSingleResult={() => {
            void handleSaveSingleResult();
          }}
          onRevealPath={(targetPath) => {
            void handleRevealPath(targetPath);
          }}
          onDownloadBatchZip={handleDownloadBatchZip}
          onResetDefaults={handleResetDefaults}
          onResetAll={handleResetAll}
        />
      </div>

      {/* Main Right Canvas Workspace */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-[#09090B] p-4 md:p-5">
        {/* Alert Banner (Error / Save Confirmation — clean human copy, failure_code in data attribute) */}
        {alert && (
          <div
            ref={alertBannerRef}
            role="alert"
            data-failure-code={alert.code ?? undefined}
            className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${
              alert.kind === 'error'
                ? 'border-[#E11D48]/50 bg-[#E11D48]/15 text-zinc-100'
                : 'border-[#10B981]/50 bg-[#10B981]/15 text-zinc-100'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              {alert.kind === 'error' ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-[#E11D48]" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#10B981]" />
              )}
              <span className="font-medium">{alert.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setAlert(null)}
              aria-label="Dismiss alert"
              className="shrink-0 rounded-md p-1 text-zinc-300 hover:bg-zinc-900/60 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Canvas Content by Mode */}
        {batchMode ? (
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {expandSidebarButton}
                <span className="rounded-lg border border-[#722ED1]/40 bg-[#722ED1]/15 px-2.5 py-1 text-xs font-semibold text-[#FAF5FF]">
                  Batch Workspace
                </span>
                <span className="hidden items-center gap-1 rounded-lg border border-zinc-800 bg-[#121215] px-2.5 py-1 text-[11px] text-zinc-400 sm:inline-flex">
                  <ClipboardPaste className="h-3 w-3 text-[#A855F7]" />
                  <span>Cmd/Ctrl+V</span>
                </span>
              </div>

              {sidebarCollapsed && canRunCurrent && (
                <button
                  type="button"
                  onClick={() => {
                    void handleRunMatch();
                  }}
                  className="hidden items-center gap-1.5 rounded-xl bg-[#722ED1] px-3.5 py-1.5 text-xs font-semibold text-[#FAF5FF] shadow-sm transition hover:bg-[#7E22CE] md:inline-flex"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Match Batch</span>
                </button>
              )}
            </div>

            <BatchStage
              isDesktop={isDesktop}
              isProcessing={isProcessing}
              batchFiles={batchFiles}
              batchDir={batchDir}
              reference={reference}
              batchResult={batchResult}
              isResultStale={
                batchResult !== null &&
                (Math.round(batchResult.intensity) !== strength ||
                  batchResult.format !== outputFormat)
              }
              onRerunBatch={() => {
                void handleRunMatch();
              }}
              resultsRef={batchResultsRef}
              isReferencePasteTarget={activePasteTarget === 'reference'}
              onActivateBatchTarget={() => setActivePasteTarget('source')}
              onActivateReferenceTarget={() => setActivePasteTarget('reference')}
              onSelectBatchFilesClick={handleSelectBatchFiles}
              onSelectBatchFolderClick={() => {
                void handleSelectBatchFolder();
              }}
              onDropBatchFiles={(files) => {
                void appendBatchFiles(files);
              }}
              onRemoveBatchFile={handleRemoveBatchFile}
              onClearBatch={handleClearBatch}
              onSelectReferenceClick={() => {
                void handleSelectReference();
              }}
              onDropReferenceFile={(file) => {
                void handleSingleFileAssigned('reference', file);
              }}
              onClearReference={() => replaceReferenceAsset(null)}
              onDownloadZip={handleDownloadBatchZip}
              onOpenOutputFolder={(dirPath) => {
                void handleRevealPath(dirPath);
              }}
            />
          </div>
        ) : singleResult && singleCanvasView === 'result' ? (
          /* Single Mode — Split Comparison Result Stage */
          <div ref={singleResultStageRef} className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-zinc-800/90 bg-[#121215] px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {expandSidebarButton}

                <button
                  type="button"
                  onClick={() => setSingleCanvasView('inputs')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700/90 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF]"
                >
                  <Images className="h-3.5 w-3.5 text-[#A855F7]" />
                  <span>Edit Inputs</span>
                </button>

                {reference && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      void handleSelectReference();
                    }}
                    title="Replace Color Reference"
                    className="inline-flex max-w-[230px] items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF]"
                  >
                    {reference.previewUrl ? (
                      <img
                        src={reference.previewUrl}
                        alt="Reference swatch"
                        className="h-5 w-5 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <Palette className="h-3.5 w-3.5 shrink-0 text-[#A855F7]" />
                    )}
                    <RefreshCw className="h-3 w-3 shrink-0 text-[#A855F7]" />
                    <span className="truncate font-medium">Change Ref: {reference.name}</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={!canSwapSingle}
                  onClick={handleSwapSourceReference}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-[#722ED1] hover:text-[#FAF5FF] disabled:opacity-40"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  <span>Swap</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 font-mono text-[11px] text-zinc-300">
                  {singleResult.width}×{singleResult.height} px ·{' '}
                  {Math.round(singleResult.breakdown_ms.total_ms)} ms
                </span>

                <button
                  type="button"
                  onClick={() => {
                    void handleSaveSingleResult();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#722ED1] px-3.5 py-1.5 text-xs font-semibold text-[#FAF5FF] shadow-sm transition hover:bg-[#7E22CE]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>
                    {isDesktop
                      ? `Save ${singleResult.format.toUpperCase()}`
                      : `Download ${singleResult.format.toUpperCase()}`}
                  </span>
                </button>

                {isDesktop && singleResult.output_path && (
                  <button
                    type="button"
                    onClick={() => {
                      if (singleResult.output_path) {
                        void handleRevealPath(singleResult.output_path);
                      }
                    }}
                    aria-label="Reveal output file"
                    title="Reveal in Folder"
                    className="inline-flex items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF]"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <BeforeAfterSlider
              beforeUrl={source?.previewUrl ?? null}
              afterUrl={singleResult.preview_data_url}
              intensity={singleResult.intensity}
              width={singleResult.width}
              height={singleResult.height}
              isUpdating={isAutoUpdating || isProcessing}
            />
          </div>
        ) : (
          /* Single Mode — Dual Dropzone Input Stage */
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {expandSidebarButton}
                <span className="rounded-lg border border-[#722ED1]/40 bg-[#722ED1]/15 px-2.5 py-1 text-xs font-semibold text-[#FAF5FF]">
                  Single Match
                </span>
                <span className="hidden items-center gap-1 rounded-lg border border-zinc-800 bg-[#121215] px-2.5 py-1 text-[11px] text-zinc-400 sm:inline-flex">
                  <ClipboardPaste className="h-3 w-3 text-[#A855F7]" />
                  <span>Cmd/Ctrl+V</span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                {canSwapSingle && (
                  <button
                    type="button"
                    onClick={handleSwapSourceReference}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-[#121215] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-[#722ED1] hover:text-[#FAF5FF]"
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    <span>Swap Photos</span>
                  </button>
                )}

                {singleResult && (
                  <button
                    type="button"
                    onClick={() => setSingleCanvasView('result')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#722ED1]/50 bg-[#722ED1]/20 px-3 py-1.5 text-xs font-semibold text-[#FAF5FF] transition hover:bg-[#722ED1]/35"
                  >
                    <Columns2 className="h-3.5 w-3.5" />
                    <span>Split Result</span>
                  </button>
                )}

                {sidebarCollapsed && canRunCurrent && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleRunMatch();
                    }}
                    className="hidden items-center gap-1.5 rounded-xl bg-[#722ED1] px-3.5 py-1.5 text-xs font-semibold text-[#FAF5FF] shadow-sm transition hover:bg-[#7E22CE] md:inline-flex"
                  >
                    {isProcessing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    <span>Match Tone</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
              <DropzoneCard
                stepLabel="Step 1"
                title="Your Photo"
                subtitle="Photo to Recolor"
                emptyActionLabel="Drop Your Photo"
                formatHint="PNG · JPG · WEBP · TIFF · BMP"
                variant="source"
                asset={source}
                isActivePasteTarget={activePasteTarget === 'source'}
                disabled={isProcessing}
                onActivateTarget={() => setActivePasteTarget('source')}
                onSelectClick={() => {
                  void handleSelectSource();
                }}
                onDropFile={(file) => {
                  void handleSingleFileAssigned('source', file);
                }}
                onClear={() => replaceSourceAsset(null)}
              />

              <DropzoneCard
                stepLabel="Step 2"
                title="Color Reference"
                subtitle="Style to Copy"
                emptyActionLabel="Drop Color Reference"
                formatHint="PNG · JPG · WEBP · TIFF · BMP"
                variant="reference"
                asset={reference}
                isActivePasteTarget={activePasteTarget === 'reference'}
                disabled={isProcessing}
                onActivateTarget={() => setActivePasteTarget('reference')}
                onSelectClick={() => {
                  void handleSelectReference();
                }}
                onDropFile={(file) => {
                  void handleSingleFileAssigned('reference', file);
                }}
                onClear={() => replaceReferenceAsset(null)}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
