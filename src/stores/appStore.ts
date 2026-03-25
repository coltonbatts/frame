import { convertFileSrc } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { analyzeMediaFile, getProcessablePath } from '../lib/analysis';
import {
  buildExportFileName,
  buildExportJob,
  defaultExportPreset,
  runExportJob,
} from '../lib/export';
import { formatDuration } from '../lib/format';
import type {
  AnalysisSectionKey,
  ExportPreset,
  ProjectFile,
  QueueItem,
  TranscriptExportFormat,
} from '../types/models';

interface AppState {
  files: ProjectFile[];
  queue: QueueItem[];
  selectedFileId: string | null;
  settingsOpen: boolean;
  sceneSensitivity: number;
  transcriptFormat: TranscriptExportFormat;
  analysisSections: Record<AnalysisSectionKey, boolean>;
  addImportedFiles: (files: ProjectFile[]) => void;
  removeSelectedFile: () => void;
  selectFile: (fileId: string) => void;
  toggleSettings: () => void;
  enqueueSelectedFile: () => void;
  pauseQueueItem: (queueId: string) => void;
  cancelQueueItem: (queueId: string) => void;
  clearCompleted: () => void;
  updateQueueProgress: (queueId: string, progress: number) => void;
  tickQueue: () => void;
  processQueue: () => Promise<void>;
  toggleAnalysisSection: (key: AnalysisSectionKey) => void;
  setSceneSensitivity: (value: number) => void;
  addTag: (fileId: string, tag: string) => void;
  removeTag: (fileId: string, tag: string) => void;
  setTranscriptFormat: (format: TranscriptExportFormat) => void;
  processSelectedFile: () => Promise<void>;
}

function isBlobUrl(sourceUrl?: string): boolean {
  return typeof sourceUrl === 'string' && sourceUrl.startsWith('blob:');
}

function formatExportCodec(codec: ExportPreset['videoCodec']): string {
  switch (codec) {
    case 'h264':
      return 'H.264';
    case 'h265':
      return 'H.265';
    case 'vp9':
      return 'VP9';
    case 'prores':
      return 'ProRes';
    default:
      return codec;
  }
}

function estimateQueueEta(file: ProjectFile, preset: ExportPreset): string {
  if (file.duration <= 0) {
    return '00:00';
  }

  const codecFactor =
    preset.videoCodec === 'prores'
      ? 0.75
      : preset.videoCodec === 'vp9'
        ? 0.6
        : 0.45;

  return formatDuration(Math.max(1, file.duration * codecFactor));
}

function createExportFromQueue(
  file: ProjectFile,
  outputPath: string,
  preset: ExportPreset,
  queueId: string,
): ProjectFile {
  return {
    ...file,
    id: `export-${queueId}`,
    folder: 'export',
    name: buildExportFileName(file, preset),
    path: outputPath,
    localPath: outputPath,
    codec: formatExportCodec(preset.videoCodec),
    state: 'done',
    outputPath,
    sourceUrl: convertFileSrc(outputPath),
    progress: undefined,
  };
}

function upsertExportFile(files: ProjectFile[], exportFile: ProjectFile): ProjectFile[] {
  const index = files.findIndex(
    (file) => file.folder === 'export' && file.outputPath === exportFile.outputPath,
  );

  if (index === -1) {
    return [...files, exportFile];
  }

  const nextFiles = [...files];
  nextFiles[index] = {
    ...exportFile,
    id: nextFiles[index].id,
  };
  return nextFiles;
}

let queueWorkerActive = false;

export const useAppStore = create<AppState>((set, get) => ({
  files: [],
  queue: [],
  selectedFileId: null,
  settingsOpen: false,
  sceneSensitivity: 58,
  transcriptFormat: 'srt',
  analysisSections: {
    scenes: true,
    palette: true,
    audio: true,
    tags: true,
  },
  addImportedFiles: (files) =>
    set((state) => {
      const nextFiles = [...files, ...state.files.filter((file) => file.folder === 'raw')];
      const exports = state.files.filter((file) => file.folder === 'export');

      return {
        files: [...nextFiles, ...exports],
        selectedFileId: files[0]?.id ?? state.selectedFileId,
      };
    }),
  removeSelectedFile: () => {
    set((state) => {
      if (!state.selectedFileId) {
        return state;
      }

      const activeQueueItem = state.queue.find(
        (item) =>
          item.fileId === state.selectedFileId &&
          item.state !== 'done' &&
          item.state !== 'error',
      );
      if (activeQueueItem) {
        return state;
      }

      const removedFile = state.files.find((file) => file.id === state.selectedFileId);
      if (removedFile?.sourceUrl && isBlobUrl(removedFile.sourceUrl)) {
        URL.revokeObjectURL(removedFile.sourceUrl);
      }

      const files = state.files.filter((file) => file.id !== state.selectedFileId);
      const nextSelection = files.find((file) => file.folder === 'raw')?.id ?? null;

      return {
        files,
        queue: state.queue.filter((item) => item.fileId !== state.selectedFileId),
        selectedFileId: nextSelection,
      };
    });

    void get().processQueue();
  },
  selectFile: (selectedFileId) => set({ selectedFileId }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),
  enqueueSelectedFile: async () => {
    const state = get();
    const file = state.files.find((item) => item.id === state.selectedFileId);

    if (!file || file.folder === 'export') {
      return;
    }

    const existing = state.queue.find((item) => item.fileId === file.id && item.state !== 'done');
    if (existing) {
      return;
    }

    try {
      const queueId = `queue-${Date.now()}`;
      const exportJob = await buildExportJob(file, defaultExportPreset, queueId);
      const queueItem: QueueItem = {
        id: queueId,
        fileId: file.id,
        preset: defaultExportPreset,
        progress: 0,
        state: 'queued',
        eta: estimateQueueEta(file, defaultExportPreset),
        outputPath: exportJob.outputPath,
      };

      set((current) => ({
        queue: [...current.queue, queueItem],
        files: current.files.map((item) =>
          item.id === file.id
            ? {
                ...item,
                state: 'queued',
                progress: 0,
                outputPath: exportJob.outputPath,
                errorMessage: undefined,
              }
            : item,
        ),
      }));

      void get().processQueue();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to queue export.';

      set((current) => ({
        files: current.files.map((item) =>
          item.id === file.id
            ? {
                ...item,
                state: 'error',
                progress: undefined,
                errorMessage: message,
              }
            : item,
        ),
      }));
    }
  },
  pauseQueueItem: (queueId) => {
    set((state) => ({
      queue: state.queue.map((item) => {
        if (
          item.id !== queueId ||
          item.state === 'processing' ||
          item.state === 'done' ||
          item.state === 'error'
        ) {
          return item;
        }

        return {
          ...item,
          state: item.state === 'paused' ? 'queued' : 'paused',
        };
      }),
      files: state.files.map((file) => {
        const queueItem = state.queue.find((entry) => entry.id === queueId);

        if (!queueItem || queueItem.fileId !== file.id || queueItem.state === 'processing') {
          return file;
        }

        const nextState =
          queueItem.state === 'paused' ? 'queued' : file.analysis ? 'done' : 'idle';

        return {
          ...file,
          state: nextState,
          progress: undefined,
        };
      }),
    }));

    void get().processQueue();
  },
  cancelQueueItem: (queueId) => {
    set((state) => {
      const queueItem = state.queue.find((item) => item.id === queueId);
      if (queueItem?.state === 'processing') {
        return state;
      }

      return {
        queue: state.queue.filter((item) => item.id !== queueId),
        files: state.files.map((file) =>
          queueItem?.fileId === file.id
            ? {
                ...file,
                state: file.analysis ? 'done' : 'idle',
                progress: undefined,
                outputPath: undefined,
              }
            : file,
        ),
      };
    });

    void get().processQueue();
  },
  clearCompleted: () => {
    set((state) => ({
      queue: state.queue.filter((item) => item.state !== 'done'),
    }));

    void get().processQueue();
  },
  updateQueueProgress: (queueId, progress) =>
    set((state) => {
      const queueItem = state.queue.find((item) => item.id === queueId);
      if (!queueItem || queueItem.state !== 'processing') {
        return state;
      }

      return {
        queue: state.queue.map((item) =>
          item.id === queueId ? { ...item, progress: Math.max(0, Math.min(100, progress)) } : item,
        ),
        files: state.files.map((file) =>
          file.id === queueItem.fileId && file.state === 'processing'
            ? {
                ...file,
                progress: Math.max(0, Math.min(100, progress)),
              }
            : file,
        ),
      };
    }),
  tickQueue: () => {
    void get().processQueue();
  },
  processQueue: async () => {
    if (queueWorkerActive) {
      return;
    }

    const state = get();

    if (state.queue.some((item) => item.state === 'processing')) {
      return;
    }

    const nextQueued = state.queue.find((item) => item.state === 'queued');
    if (!nextQueued) {
      return;
    }

    const sourceFile = state.files.find((file) => file.id === nextQueued.fileId);
    if (!sourceFile || sourceFile.folder !== 'raw') {
      set((current) => ({
        queue: current.queue.map((item) =>
          item.id === nextQueued.id
            ? {
                ...item,
                state: 'error',
                progress: 0,
                error: 'Source file is no longer available.',
              }
            : item,
        ),
      }));
      void get().processQueue();
      return;
    }

    queueWorkerActive = true;

    try {
      const outputPath =
        nextQueued.outputPath ??
        (await buildExportJob(sourceFile, nextQueued.preset, nextQueued.id)).outputPath;

      const job = {
        queueId: nextQueued.id,
        inputPath: sourceFile.localPath ?? sourceFile.path,
        outputPath,
        duration: sourceFile.duration,
        preset: nextQueued.preset,
      };

      set((current) => ({
        queue: current.queue.map((item) =>
          item.id === nextQueued.id
            ? {
                ...item,
                state: 'processing',
                progress: Math.max(item.progress, 1),
                eta: estimateQueueEta(sourceFile, nextQueued.preset),
                outputPath,
                error: undefined,
              }
            : item,
        ),
        files: current.files.map((file) =>
          file.id === sourceFile.id
            ? {
                ...file,
                state: 'processing',
                progress: Math.max(file.progress ?? 0, 1),
                outputPath,
                errorMessage: undefined,
              }
            : file,
        ),
      }));

      await runExportJob(job);

      set((current) => {
        const currentSourceFile = current.files.find((file) => file.id === sourceFile.id) ?? sourceFile;
        const nextFiles = upsertExportFile(
          current.files,
          createExportFromQueue(currentSourceFile, outputPath, nextQueued.preset, nextQueued.id),
        );

        return {
          queue: current.queue.map((item) =>
            item.id === nextQueued.id
              ? {
                  ...item,
                  state: 'done',
                  progress: 100,
                  eta: '00:00',
                  outputPath,
                  error: undefined,
                }
              : item,
          ),
          files: nextFiles.map((file) =>
            file.id === sourceFile.id
              ? {
                  ...file,
                  state: 'done',
                  progress: undefined,
                  outputPath,
                  errorMessage: undefined,
                }
              : file,
          ),
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Export failed unexpectedly.';

      set((current) => ({
        queue: current.queue.map((item) =>
          item.id === nextQueued.id
            ? {
                ...item,
                state: 'error',
                progress: 0,
                error: errorMessage,
              }
            : item,
        ),
        files: current.files.map((file) =>
          file.id === sourceFile.id
            ? {
                ...file,
                state: 'error',
                progress: undefined,
                errorMessage,
              }
            : file,
        ),
      }));
    } finally {
      queueWorkerActive = false;
      void get().processQueue();
    }
  },
  toggleAnalysisSection: (key) =>
    set((state) => ({
      analysisSections: {
        ...state.analysisSections,
        [key]: !state.analysisSections[key],
      },
    })),
  setSceneSensitivity: (sceneSensitivity) => set({ sceneSensitivity }),
  addTag: (fileId, tag) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === fileId && tag.trim() && !file.tags.includes(tag.trim())
          ? { ...file, tags: [...file.tags, tag.trim()] }
          : file,
      ),
    })),
  removeTag: (fileId, tag) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === fileId ? { ...file, tags: file.tags.filter((entry) => entry !== tag) } : file,
      ),
    })),
  setTranscriptFormat: (transcriptFormat) => set({ transcriptFormat }),
  processSelectedFile: async () => {
    const state = get();
    const file = state.files.find((entry) => entry.id === state.selectedFileId);

    if (!file || file.folder !== 'raw') {
      return;
    }

    const processablePath = getProcessablePath(file);
    if (!processablePath) {
      set((current) => ({
        files: current.files.map((entry) =>
          entry.id === file.id
            ? {
                ...entry,
                state: 'error',
                progress: undefined,
                errorMessage:
                  'Local analysis needs a filesystem path. Re-import this file with the native picker in Frame.',
              }
            : entry,
        ),
      }));
      return;
    }

    set((current) => ({
      files: current.files.map((entry) =>
        entry.id === file.id
          ? {
              ...entry,
              state: 'analyzing',
              progress: 18,
              errorMessage: undefined,
            }
          : entry,
      ),
    }));

    try {
      const result = await analyzeMediaFile(processablePath, state.sceneSensitivity);

      set((current) => ({
        files: current.files.map((entry) =>
          entry.id === file.id
            ? {
                ...entry,
                state: 'done',
                progress: undefined,
                analysis: result.analysis,
                thumbnailColor: result.thumbnailColor || entry.thumbnailColor,
                tags: Array.from(new Set([...entry.tags, ...result.tags])),
                errorMessage: undefined,
              }
            : entry,
        ),
      }));
    } catch (error) {
      set((current) => ({
        files: current.files.map((entry) =>
          entry.id === file.id
            ? {
                ...entry,
                state: 'error',
                progress: undefined,
                errorMessage:
                  error instanceof Error ? error.message : 'Analysis failed unexpectedly.',
              }
            : entry,
        ),
      }));
    }
  },
}));

export function useSelectedFile(): ProjectFile | undefined {
  return useAppStore((state) =>
    state.files.find((file) => file.id === state.selectedFileId),
  );
}
