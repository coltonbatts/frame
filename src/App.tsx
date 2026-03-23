import { useCallback, useEffect, useRef, useState } from 'react';
import { AnalysisPanel } from './components/analysis/AnalysisPanel';
import { TitleBar } from './components/layout/TitleBar';
import { ProjectBin } from './components/project-bin/ProjectBin';
import { QueueBar } from './components/queue/QueueBar';
import { SettingsModal } from './components/settings/SettingsModal';
import { ProgressBar } from './components/ui/ProgressBar';
import { VideoPreview } from './components/video-preview/VideoPreview';
import { useWindowWidth } from './hooks/useWindowWidth';
import {
  createProjectFileFromUpload,
  createProjectFileFromPath,
  openNativeFileDialog,
} from './lib/media';
import { useAppStore, useSelectedFile } from './stores/appStore';

import type { ProjectFile } from './types/models';

const ACCEPTED_UPLOADS =
  'video/*,audio/*,.mov,.m4v,.mp4,.mkv,.webm,.avi,.mxf,.mpg,.mpeg,.mp3,.wav,.flac,.m4a,.aac,.aiff,.aif,.alac,.ogg,.oga';

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

export default function App(): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
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
  const tickQueue = useAppStore((state) => state.tickQueue);
  const toggleAnalysisSection = useAppStore((state) => state.toggleAnalysisSection);
  const setSceneSensitivity = useAppStore((state) => state.setSceneSensitivity);
  const addTag = useAppStore((state) => state.addTag);
  const removeTag = useAppStore((state) => state.removeTag);
  const setTranscriptFormat = useAppStore((state) => state.setTranscriptFormat);

  useEffect(() => {
    setDuration(selectedFile?.duration ?? 0);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [selectedFile?.id, selectedFile?.duration]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      tickQueue();
    }, 900);

    return () => window.clearInterval(timer);
  }, [tickQueue]);


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
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (isTyping) {
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
  }, [duration, removeSelectedFile, selectedFile?.fps, toggleSettings, handleNativeImport]);

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

  const handleImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const fileList = Array.from(event.target.files ?? []);

    try {
      await importFiles(fileList);
    } finally {
      event.target.value = '';
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
        <TitleBar onImport={handleNativeImport} onSettings={toggleSettings} />

        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          multiple
          accept={ACCEPTED_UPLOADS}
          onChange={(event) => void handleImport(event)}
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
              onImport={() => inputRef.current?.click()}
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
