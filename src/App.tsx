import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AnalysisPanel } from './components/analysis/AnalysisPanel';
import { TitleBar } from './components/layout/TitleBar';
import { ProjectBin } from './components/project-bin/ProjectBin';
import { QueueBar } from './components/queue/QueueBar';
import { SettingsModal } from './components/settings/SettingsModal';
import { ShotListPanel } from './components/shot-list/ShotListPanel';
import { ProgressBar } from './components/ui/ProgressBar';
import { VideoPreview } from './components/video-preview/VideoPreview';
import { useWindowWidth } from './hooks/useWindowWidth';
import {
  createProjectFileFromUpload,
  createProjectFileFromPath,
  openNativeFileDialog,
} from './lib/media';
import {
  canCaptureShots,
  captureShot,
  deleteShot,
  exportShotListZip,
  getShotListVideoPath,
  loadShotList,
  pickShotOutputDirectory,
  revealPathInFinder,
  setShotOutputDirectory,
  updateShotLabel,
} from './lib/shots';
import type { ExportProgressEvent } from './lib/export';
import { useAppStore, useSelectedFile } from './stores/appStore';

import type { ProjectFile, ShotListState } from './types/models';

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
  const [shotListCollapsed, setShotListCollapsed] = useState(false);
  const [shotList, setShotList] = useState<ShotListState | null>(null);
  const [shotListBusy, setShotListBusy] = useState(false);
  const [shotListExporting, setShotListExporting] = useState(false);
  const [shotListError, setShotListError] = useState<string | null>(null);
  const [shotListMessage, setShotListMessage] = useState<string | null>(null);

  const files = useAppStore((state) => state.files);
  const queue = useAppStore((state) => state.queue);
  const selectedFileId = useAppStore((state) => state.selectedFileId);
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const analysisSections = useAppStore((state) => state.analysisSections);
  const sceneSensitivity = useAppStore((state) => state.sceneSensitivity);
  const transcriptFormat = useAppStore((state) => state.transcriptFormat);
  const addImportedFiles = useAppStore((state) => state.addImportedFiles);
  const removeSelectedFile = useAppStore((state) => state.removeSelectedFile);
  const selectFile = useAppStore((state) => state.selectFile);
  const toggleSettings = useAppStore((state) => state.toggleSettings);
  const enqueueSelectedFile = useAppStore((state) => state.enqueueSelectedFile);
  const pauseQueueItem = useAppStore((state) => state.pauseQueueItem);
  const cancelQueueItem = useAppStore((state) => state.cancelQueueItem);
  const clearCompleted = useAppStore((state) => state.clearCompleted);
  const toggleAnalysisSection = useAppStore((state) => state.toggleAnalysisSection);
  const setSceneSensitivity = useAppStore((state) => state.setSceneSensitivity);
  const addTag = useAppStore((state) => state.addTag);
  const removeTag = useAppStore((state) => state.removeTag);
  const setTranscriptFormat = useAppStore((state) => state.setTranscriptFormat);
  const processSelectedFile = useAppStore((state) => state.processSelectedFile);
  const selectedVideoPath = getShotListVideoPath(selectedFile);
  const selectedFileHasVideo = Boolean(selectedFile && selectedFile.width > 0 && selectedFile.height > 0);
  const shotCaptureEnabled = Boolean(selectedVideoPath && selectedFileHasVideo);
  const shotHotkeyHint = isApplePlatform() ? '⌘⇧S' : 'Ctrl+Shift+S';

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

    if (!shotCaptureEnabled || !selectedVideoPath) {
      setShotList(null);
      setShotListError(null);
      setShotListMessage(null);
      return () => {
        cancelled = true;
      };
    }

    setShotListError(null);
    setShotListMessage(null);

    void loadShotList(selectedVideoPath)
      .then((nextShotList) => {
        if (!cancelled) {
          setShotList(nextShotList);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setShotList(null);
          setShotListError(
            error instanceof Error ? error.message : 'Failed to load the shot list.',
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFile?.id, selectedVideoPath, shotCaptureEnabled]);

  const handleCaptureShot = useCallback(async (): Promise<void> => {
    if (!selectedFile || !canCaptureShots(selectedFile)) {
      return;
    }

    const videoPath = getShotListVideoPath(selectedFile);
    if (!videoPath) {
      return;
    }

    setShotListBusy(true);
    setShotListError(null);
    setShotListMessage(null);

    try {
      const nextShotList = await captureShot({
        videoPath,
        timestampSeconds: Math.max(0, currentTime),
        fps: selectedFile.fps,
      });

      setShotList(nextShotList);
      const latestShot = nextShotList.shots[nextShotList.shots.length - 1];
      setShotListMessage(
        latestShot
          ? `Captured ${latestShot.thumbnailName} at ${latestShot.timestampReadable}.`
          : 'Shot captured.',
      );
    } catch (error) {
      setShotListError(getErrorMessage(error, 'Failed to capture shot.'));
    } finally {
      setShotListBusy(false);
    }
  }, [currentTime, selectedFile]);

  const handleShotLabelChange = useCallback(
    async (shotNumber: number, sceneLabel: string): Promise<void> => {
      const videoPath = getShotListVideoPath(selectedFile);
      if (!videoPath) {
        return;
      }

      setShotListBusy(true);
      setShotListError(null);

      try {
        const nextShotList = await updateShotLabel({
          videoPath,
          shotNumber,
          sceneLabel,
        });
        setShotList(nextShotList);
      } catch (error) {
        setShotListError(getErrorMessage(error, 'Failed to update scene label.'));
      } finally {
        setShotListBusy(false);
      }
    },
    [selectedFile],
  );

  const handleDeleteShot = useCallback(
    async (shotNumber: number): Promise<void> => {
      const videoPath = getShotListVideoPath(selectedFile);
      if (!videoPath) {
        return;
      }

      setShotListBusy(true);
      setShotListError(null);
      setShotListMessage(null);

      try {
        const nextShotList = await deleteShot({
          videoPath,
          shotNumber,
        });
        setShotList(nextShotList);
        setShotListMessage(`Removed shot ${shotNumber.toString().padStart(3, '0')}.`);
      } catch (error) {
        setShotListError(getErrorMessage(error, 'Failed to delete shot.'));
      } finally {
        setShotListBusy(false);
      }
    },
    [selectedFile],
  );

  const handleChooseShotFolder = useCallback(async (): Promise<void> => {
    const videoPath = getShotListVideoPath(selectedFile);
    if (!videoPath) {
      return;
    }

    const folder = await pickShotOutputDirectory(shotList?.outputDir);
    if (!folder) {
      return;
    }

    setShotListBusy(true);
    setShotListError(null);
    setShotListMessage(null);

    try {
      const nextShotList = await setShotOutputDirectory({
        videoPath,
        outputDir: folder,
      });
      setShotList(nextShotList);
      setShotListMessage(`Shot output moved to ${nextShotList.outputDir}.`);
    } catch (error) {
      setShotListError(getErrorMessage(error, 'Failed to update the shot output folder.'));
    } finally {
      setShotListBusy(false);
    }
  }, [selectedFile, shotList?.outputDir]);

  const handleExportShotList = useCallback(async (): Promise<void> => {
    const videoPath = getShotListVideoPath(selectedFile);
    if (!videoPath) {
      return;
    }

    setShotListExporting(true);
    setShotListError(null);
    setShotListMessage(null);

    try {
      const zipPath = await exportShotListZip(videoPath);
      setShotListMessage(`ZIP ready at ${zipPath}.`);
      await revealPathInFinder(zipPath).catch(() => undefined);
    } catch (error) {
      setShotListError(getErrorMessage(error, 'Failed to export shot list.'));
    } finally {
      setShotListExporting(false);
    }
  }, [selectedFile]);

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

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleCaptureShot();
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
    handleCaptureShot,
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
          shotHotkeyHint={shotHotkeyHint}
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

            <AnalysisPanel
              file={selectedFile}
              sections={analysisSections}
              sensitivity={sceneSensitivity}
              transcriptFormat={transcriptFormat}
              collapsed={rightCollapsed}
              onToggleCollapsed={() => setRightCollapsed((value) => !value)}
              onToggleSection={toggleAnalysisSection}
              onSensitivityChange={setSceneSensitivity}
              onSeek={setCurrentTime}
              onAddTag={(tag) => {
                if (selectedFile) {
                  addTag(selectedFile.id, tag);
                }
              }}
              onRemoveTag={(tag) => {
                if (selectedFile) {
                  removeTag(selectedFile.id, tag);
                }
              }}
              onTranscriptFormatChange={setTranscriptFormat}
              onProcess={processSelectedFile}
            />

            <ShotListPanel
              file={selectedFile}
              shotList={shotList}
              collapsed={shotListCollapsed}
              busy={shotListBusy}
              exporting={shotListExporting}
              error={shotListError}
              message={shotListMessage}
              hotkeyHint={shotHotkeyHint}
              onToggleCollapsed={() => setShotListCollapsed((value) => !value)}
              onCapture={handleCaptureShot}
              onExportZip={handleExportShotList}
              onChooseFolder={handleChooseShotFolder}
              onSeek={setCurrentTime}
              onLabelChange={handleShotLabelChange}
              onDelete={handleDeleteShot}
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
