import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { TitleBar } from './components/layout/TitleBar';
import { ProvenancePanel } from './components/provenance/ProvenancePanel';
import { ProjectBin } from './components/project-bin/ProjectBin';
import { QueueBar } from './components/queue/QueueBar';
import { SettingsModal } from './components/settings/SettingsModal';
import { ProgressBar } from './components/ui/ProgressBar';
import { VideoPreview } from './components/video-preview/VideoPreview';
import { useWindowWidth } from './hooks/useWindowWidth';
import {
  captureHdFrame,
  createProjectFileFromUpload,
  createProjectFileFromPath,
  openNativeFileDialog,
} from './lib/media';
import {
  analyzeProvenance,
  canAnalyzeProvenance,
  deleteProvenanceShot,
  getProvenanceVideoPath,
  loadProvenance,
  updateProvenanceShot,
  revealPathInFinder as revealProvenancePathInFinder,
} from './lib/provenance';
import type { ExportProgressEvent } from './lib/export';
import { useAppStore, useSelectedFile } from './stores/appStore';

import type { ProjectFile, ProvenanceState, ShotRecord } from './types/models';

type ImportProgress = {
  completed: number;
  currentName: string;
  total: number;
};

function isFileDrag(event: React.DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === 'string' && candidate.message.trim().length > 0) {
      return candidate.message;
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export default function App(): JSX.Element {
  const dragDepth = useRef(0);
  const selectedFile = useSelectedFile();
  const windowWidth = useWindowWidth();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(selectedFile?.duration ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceState | null>(null);
  const [provenanceBusy, setProvenanceBusy] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [provenanceError, setProvenanceError] = useState<string | null>(null);
  const [provenanceMessage, setProvenanceMessage] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);

  const files = useAppStore((state) => state.files);
  const queue = useAppStore((state) => state.queue);
  const selectedFileId = useAppStore((state) => state.selectedFileId);
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const sceneSensitivity = useAppStore((state) => state.sceneSensitivity);
  const addImportedFiles = useAppStore((state) => state.addImportedFiles);
  const removeSelectedFile = useAppStore((state) => state.removeSelectedFile);
  const selectFile = useAppStore((state) => state.selectFile);
  const toggleSettings = useAppStore((state) => state.toggleSettings);
  const enqueueSelectedFile = useAppStore((state) => state.enqueueSelectedFile);
  const pauseQueueItem = useAppStore((state) => state.pauseQueueItem);
  const cancelQueueItem = useAppStore((state) => state.cancelQueueItem);
  const clearCompleted = useAppStore((state) => state.clearCompleted);
  const setSceneSensitivity = useAppStore((state) => state.setSceneSensitivity);
  const selectedVideoPath = getProvenanceVideoPath(selectedFile);
  const provenanceHotkeyHint = isApplePlatform() ? '⌘⇧A' : 'Ctrl+Shift+A';
  const captureHotkeyHint = isApplePlatform() ? '⌘⇧S' : 'Ctrl+Shift+S';

  useEffect(() => {
    setDuration(selectedFile?.duration ?? 0);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [selectedFile?.id, selectedFile?.duration]);

  useEffect(() => {
    let cancelled = false;
    let unlistenProgress: (() => void) | undefined;

    void (async () => {
      try {
        const dispose = await listen<ExportProgressEvent>('export:progress', (event) => {
          useAppStore.getState().updateQueueProgress(event.payload.queueId, event.payload.progress);
        });

        if (cancelled) {
          void dispose();
          return;
        }

        unlistenProgress = dispose;
      } catch (error) {
        console.error('Failed to subscribe to export progress:', error);
      }
    })();

    return () => {
      cancelled = true;
      void unlistenProgress?.();
    };
  }, []);

  const handleNativeImport = useCallback(async (): Promise<void> => {
    try {
      const paths = await openNativeFileDialog();
      if (paths.length === 0) return;

      setImportProgress({ completed: 0, currentName: 'Opening files...', total: paths.length });
      const imported: ProjectFile[] = [];

      for (let i = 0; i < paths.length; i++) {
        setImportProgress({
          completed: i,
          currentName: paths[i].split('/').pop() ?? paths[i],
          total: paths.length,
        });
        try {
          const file = await createProjectFileFromPath(paths[i], i);
          imported.push(file);
        } catch (err) {
          console.error(`Failed to import ${paths[i]}:`, err);
        }
        if (i < paths.length - 1) await yieldToBrowser();
      }

      if (imported.length > 0) addImportedFiles(imported);
    } catch (err) {
      console.error('Native import failed:', err);
    } finally {
      setImportProgress(null);
    }
  }, [addImportedFiles]);

  useEffect(() => {
    setRightCollapsed(windowWidth < 1280);
    setLeftCollapsed(windowWidth < 1024);
  }, [windowWidth]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedVideoPath) {
      setProvenance(null);
      setSelectedShotId(null);
      setProvenanceError(null);
      setProvenanceMessage(null);
      return () => {
        cancelled = true;
      };
    }

    setProvenanceError(null);
    setProvenanceMessage(null);

    void loadProvenance(selectedVideoPath)
      .then((nextProvenance) => {
        if (!cancelled) {
          setProvenance(nextProvenance);
          setSelectedShotId(nextProvenance?.shots[0]?.id ?? null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setProvenance(null);
          setSelectedShotId(null);
          setProvenanceError(
            error instanceof Error ? error.message : 'Failed to load the provenance sidecar.',
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFile?.id, selectedVideoPath]);

  const handleAnalyzeProvenance = useCallback(async (): Promise<void> => {
    if (
      captureBusy ||
      !selectedFile ||
      !selectedVideoPath ||
      !canAnalyzeProvenance(selectedFile)
    ) {
      return;
    }

    setProvenanceBusy(true);
    setProvenanceError(null);
    setProvenanceMessage(null);

    try {
      const nextProvenance = await analyzeProvenance({
        path: selectedVideoPath,
        sensitivity: sceneSensitivity,
      });

      setProvenance(nextProvenance);
      setSelectedShotId(nextProvenance.shots[0]?.id ?? null);
      setProvenanceMessage(
        `Detected ${nextProvenance.shots.length} shots and wrote local exports to ${nextProvenance.outputDir}.`,
      );
    } catch (error) {
      setProvenanceError(getErrorMessage(error, 'Failed to analyze provenance.'));
    } finally {
      setProvenanceBusy(false);
    }
  }, [captureBusy, sceneSensitivity, selectedFile, selectedVideoPath]);

  const handleCaptureHdFrame = useCallback(async (): Promise<void> => {
    if (
      captureBusy ||
      provenanceBusy ||
      !selectedFile ||
      !selectedVideoPath ||
      !canAnalyzeProvenance(selectedFile)
    ) {
      return;
    }

    setIsPlaying(false);
    setCaptureBusy(true);
    setProvenanceError(null);
    setProvenanceMessage(null);

    try {
      const capture = await captureHdFrame({
        videoPath: selectedVideoPath,
        time: currentTime,
      });

      setProvenanceMessage(
        `Captured ${capture.fileName} at ${capture.timecode} (${capture.width}x${capture.height}).`,
      );
      await revealProvenancePathInFinder(capture.outputPath).catch(() => undefined);
    } catch (error) {
      setProvenanceError(getErrorMessage(error, 'Failed to capture a high-definition frame.'));
    } finally {
      setCaptureBusy(false);
    }
  }, [captureBusy, currentTime, provenanceBusy, selectedFile, selectedVideoPath]);

  const handleUpdateProvenanceShot = useCallback(
    async (shot: ShotRecord): Promise<void> => {
      if (!selectedVideoPath) {
        return;
      }

      setProvenanceBusy(true);
      setProvenanceError(null);

      try {
        const nextProvenance = await updateProvenanceShot({
          videoPath: selectedVideoPath,
          shot,
        });
        setProvenance(nextProvenance);
        setSelectedShotId(shot.id);
        setProvenanceMessage(`Updated ${shot.id}.`);
      } catch (error) {
        setProvenanceError(getErrorMessage(error, 'Failed to update the shot record.'));
      } finally {
        setProvenanceBusy(false);
      }
    },
    [selectedVideoPath],
  );

  const handleDeleteProvenanceShot = useCallback(
    async (shotId: string): Promise<void> => {
      if (!selectedVideoPath) {
        return;
      }

      setProvenanceBusy(true);
      setProvenanceError(null);
      setProvenanceMessage(null);

      try {
        const nextProvenance = await deleteProvenanceShot({
          videoPath: selectedVideoPath,
          shotId,
        });
        setProvenance(nextProvenance);
        setSelectedShotId(nextProvenance.shots[0]?.id ?? null);
        setProvenanceMessage(`Removed ${shotId}.`);
      } catch (error) {
        setProvenanceError(getErrorMessage(error, 'Failed to delete the shot.'));
      } finally {
        setProvenanceBusy(false);
      }
    },
    [selectedVideoPath],
  );

  const handleOpenDataFolder = useCallback(async (): Promise<void> => {
    if (!provenance?.outputDir) {
      return;
    }

    await revealProvenancePathInFinder(provenance.outputDir).catch(() => undefined);
  }, [provenance?.outputDir]);

  const handleOpenThumbnails = useCallback(async (): Promise<void> => {
    if (!provenance?.thumbnailDir) {
      return;
    }

    await revealProvenancePathInFinder(provenance.thumbnailDir).catch(() => undefined);
  }, [provenance?.thumbnailDir]);

  const handleExportCsv = useCallback(async (): Promise<void> => {
    if (!provenance?.csvPath) {
      return;
    }

    await revealProvenancePathInFinder(provenance.csvPath).catch(() => undefined);
    setProvenanceMessage(`CSV ready at ${provenance.csvPath}.`);
  }, [provenance?.csvPath]);

  const handleExportJson = useCallback(async (): Promise<void> => {
    if (!provenance?.sidecarPath) {
      return;
    }

    await revealProvenancePathInFinder(provenance.sidecarPath).catch(() => undefined);
    setProvenanceMessage(`JSON ready at ${provenance.sidecarPath}.`);
  }, [provenance?.sidecarPath]);

  const handleSelectProvenanceShot = useCallback((shotId: string): void => {
    setSelectedShotId(shotId);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (isTyping) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        void handleAnalyzeProvenance();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleCaptureHdFrame();
        return;
      }

      if (event.metaKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        handleNativeImport();
      }

      if (event.metaKey && event.key === ',') {
        event.preventDefault();
        toggleSettings();
      }

      if (event.metaKey && event.key === 'Backspace') {
        event.preventDefault();
        removeSelectedFile();
      }

      if (event.key === ' ') {
        event.preventDefault();
        setIsPlaying((value) => !value);
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentTime((value) =>
          Math.max(0, value - (event.shiftKey ? 5 : 1 / (selectedFile?.fps ?? 24))),
        );
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCurrentTime((value) =>
          Math.min(duration, value + (event.shiftKey ? 5 : 1 / (selectedFile?.fps ?? 24))),
        );
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    duration,
    handleAnalyzeProvenance,
    handleCaptureHdFrame,
    removeSelectedFile,
    selectedFile?.fps,
    toggleSettings,
    handleNativeImport,
  ]);

  const importFiles = async (fileList: File[]): Promise<void> => {
    if (fileList.length === 0) {
      return;
    }

    const imported: Awaited<ReturnType<typeof createProjectFileFromUpload>>[] = [];

    try {
      for (const [index, file] of fileList.entries()) {
        setImportProgress({
          completed: index,
          currentName: file.name,
          total: fileList.length,
        });

        imported.push(await createProjectFileFromUpload(file, index));
        setImportProgress({
          completed: index + 1,
          currentName: file.name,
          total: fileList.length,
        });

        if (index < fileList.length - 1) {
          await yieldToBrowser();
        }
      }

      addImportedFiles(imported);
    } finally {
      setImportProgress(null);
    }
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepth.current += 1;
    setDraggingFiles(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);

    if (dragDepth.current === 0) {
      setDraggingFiles(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepth.current = 0;
    setDraggingFiles(false);
    void importFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <>
      <div
        className={`app-shell ${draggingFiles ? 'app-shell-dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <TitleBar
          onImport={handleNativeImport}
          onSettings={toggleSettings}
          analyzeHotkeyHint={provenanceHotkeyHint}
        />

        {importProgress && (
          <section className="import-banner" aria-live="polite">
            <div className="import-banner-copy">
              <span className="panel-kicker">Importing</span>
              <strong>{importProgress.currentName}</strong>
              <span>
                {importProgress.completed} of {importProgress.total} files processed
              </span>
            </div>
            <div className="import-banner-progress">
              <ProgressBar
                value={(importProgress.completed / Math.max(1, importProgress.total)) * 100}
              />
            </div>
          </section>
        )}

        {draggingFiles && (
          <div className="drop-overlay" aria-hidden="true">
            <div className="drop-overlay-card">
              <span className="panel-kicker">Drop to inspect</span>
              <strong>Release files anywhere to import them.</strong>
              <p>Video, audio, and other creative files will now enter the workspace without locking up the UI.</p>
            </div>
          </div>
        )}

        <main className="workspace">
          <section className="workspace-hero">
            <VideoPreview
              file={selectedFile}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              volume={volume}
              muted={muted}
              onTimeChange={setCurrentTime}
              onDurationChange={setDuration}
              onPlayingChange={setIsPlaying}
              onTogglePlay={() => setIsPlaying((value) => !value)}
              onStepFrame={(direction) =>
                setCurrentTime((value) =>
                  Math.max(
                    0,
                    Math.min(
                      duration || selectedFile?.duration || 1,
                      value + direction / (selectedFile?.fps ?? 24),
                    ),
                  ),
                )
              }
              onJump={(seconds) =>
                setCurrentTime((value) =>
                  Math.max(0, Math.min(duration || selectedFile?.duration || 1, value + seconds)),
                )
              }
              onVolumeChange={(nextVolume) => {
                setMuted(nextVolume === 0);
                setVolume(nextVolume);
              }}
              onMutedChange={setMuted}
            />
          </section>

          <section className="workspace-support">
            <ProjectBin
              files={files}
              selectedFileId={selectedFileId}
              collapsed={leftCollapsed}
              onSelect={selectFile}
              onImport={() => void handleNativeImport()}
              onRemove={removeSelectedFile}
              onQueue={enqueueSelectedFile}
              onToggleCollapsed={() => setLeftCollapsed((value) => !value)}
            />

            <ProvenancePanel
              file={selectedFile}
              provenance={provenance}
              selectedShotId={selectedShotId}
              collapsed={rightCollapsed}
              busy={provenanceBusy}
              captureBusy={captureBusy}
              captureDisabled={
                captureBusy || provenanceBusy || !selectedFile || !canAnalyzeProvenance(selectedFile)
              }
              captureHotkeyHint={captureHotkeyHint}
              error={provenanceError}
              message={provenanceMessage}
              sensitivity={sceneSensitivity}
              onToggleCollapsed={() => setRightCollapsed((value) => !value)}
              onAnalyze={handleAnalyzeProvenance}
              onCaptureHdFrame={handleCaptureHdFrame}
              onSensitivityChange={setSceneSensitivity}
              onSelectShot={handleSelectProvenanceShot}
              onSeek={setCurrentTime}
              onUpdateShot={handleUpdateProvenanceShot}
              onDeleteShot={handleDeleteProvenanceShot}
              onOpenDataFolder={handleOpenDataFolder}
              onOpenThumbnails={handleOpenThumbnails}
              onExportCsv={handleExportCsv}
              onExportJson={handleExportJson}
            />
          </section>
        </main>

        <QueueBar
          queue={queue}
          files={files}
          onPause={pauseQueueItem}
          onCancel={cancelQueueItem}
          onClearCompleted={clearCompleted}
        />
      </div>

      <SettingsModal open={settingsOpen} onClose={toggleSettings} />
    </>
  );
}
