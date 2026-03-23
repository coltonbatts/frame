import { create } from 'zustand';
import { defaultPreset, mockExport, mockFiles, mockQueue } from '../data/mock';
import type {
  AnalysisSectionKey,
  FileState,
  ProjectFile,
  QueueItem,
  QueueState,
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
  tickQueue: () => void;
  toggleAnalysisSection: (key: AnalysisSectionKey) => void;
  setSceneSensitivity: (value: number) => void;
  addTag: (fileId: string, tag: string) => void;
  removeTag: (fileId: string, tag: string) => void;
  setTranscriptFormat: (format: TranscriptExportFormat) => void;
}

function createExportFromQueue(file: ProjectFile, outputPath: string): ProjectFile {
  return {
    ...file,
    id: `export-${file.id}`,
    folder: 'export',
    name: file.name.replace(/\.[^.]+$/, '') + '_export.mp4',
    path: outputPath,
    codec: 'H.265',
    state: 'done',
    outputPath,
    progress: undefined,
  };
}

export const useAppStore = create<AppState>((set) => ({
  files: [...mockFiles, mockExport],
  queue: mockQueue,
  selectedFileId: mockFiles[0]?.id ?? null,
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
  removeSelectedFile: () =>
    set((state) => {
      if (!state.selectedFileId) {
        return state;
      }

      const removedFile = state.files.find((file) => file.id === state.selectedFileId);
      if (removedFile?.sourceUrl) {
        URL.revokeObjectURL(removedFile.sourceUrl);
      }

      const files = state.files.filter((file) => file.id !== state.selectedFileId);
      const nextSelection = files.find((file) => file.folder === 'raw')?.id ?? null;

      return {
        files,
        queue: state.queue.filter((item) => item.fileId !== state.selectedFileId),
        selectedFileId: nextSelection,
      };
    }),
  selectFile: (selectedFileId) => set({ selectedFileId }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),
  enqueueSelectedFile: () =>
    set((state) => {
      const file = state.files.find((item) => item.id === state.selectedFileId);

      if (!file || file.folder === 'export') {
        return state;
      }

      const existing = state.queue.find(
        (item) => item.fileId === file.id && item.state !== 'done',
      );

      if (existing) {
        return state;
      }

      const queueItem: QueueItem = {
        id: `queue-${Date.now()}`,
        fileId: file.id,
        preset: defaultPreset,
        progress: 0,
        state: state.queue.some((item) => item.state === 'processing') ? 'queued' : 'processing',
        eta: file.duration > 0 ? '05:12' : '00:48',
        outputPath: `/Exports/${file.name.replace(/\.[^.]+$/, '')}_${defaultPreset.videoCodec}.mp4`,
      };

      return {
        queue: [...state.queue, queueItem],
        files: state.files.map((item) =>
          item.id === file.id
            ? {
                ...item,
                state: queueItem.state === 'processing' ? 'processing' : 'queued',
                progress: queueItem.state === 'processing' ? 2 : 0,
              }
            : item,
        ),
      };
    }),
  pauseQueueItem: (queueId) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.id === queueId
          ? { ...item, state: item.state === 'paused' ? 'queued' : 'paused' }
          : item,
      ),
    })),
  cancelQueueItem: (queueId) =>
    set((state) => ({
      queue: state.queue.filter((item) => item.id !== queueId),
      files: state.files.map((file) =>
        state.queue.some((item) => item.id === queueId && item.fileId === file.id)
          ? { ...file, state: 'idle', progress: undefined }
          : file,
      ),
    })),
  clearCompleted: () =>
    set((state) => ({
      queue: state.queue.filter((item) => item.state !== 'done'),
    })),
  tickQueue: () =>
    set((state) => {
      const processing = state.queue.find((item) => item.state === 'processing');

      if (!processing) {
        const nextQueued = state.queue.find((item) => item.state === 'queued');

        if (!nextQueued) {
          return state;
        }

        return {
          queue: state.queue.map((item) =>
            item.id === nextQueued.id ? { ...item, state: 'processing', progress: 1 } : item,
          ),
          files: state.files.map((file) =>
            file.id === nextQueued.fileId ? { ...file, state: 'processing', progress: 1 } : file,
          ),
        };
      }

      const nextProgress = Math.min(100, processing.progress + 3);
      const nextState: QueueState = nextProgress >= 100 ? 'done' : 'processing';
      const outputPath =
        processing.outputPath ??
        `/Exports/${processing.fileId}_${processing.preset.videoCodec}.${processing.preset.container}`;
      const sourceFile = state.files.find((file) => file.id === processing.fileId);

      const queue = state.queue.map((item) =>
        item.id === processing.id
          ? { ...item, progress: nextProgress, state: nextState, eta: nextProgress >= 100 ? '00:00' : item.eta }
          : item,
      );

      const files = state.files.map((file) => {
        if (file.id !== processing.fileId) {
          return file;
        }

        const fileState: FileState = nextState === 'done' ? 'done' : 'processing';

        return {
          ...file,
          state: fileState,
          progress: nextState === 'done' ? undefined : nextProgress,
        };
      });

      const exports =
        nextState === 'done' && sourceFile
          ? files.some((file) => file.id === `export-${sourceFile.id}`)
            ? files
            : [...files, createExportFromQueue(sourceFile, outputPath)]
          : files;

      return {
        queue,
        files: exports,
      };
    }),
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
}));

export function useSelectedFile(): ProjectFile | undefined {
  return useAppStore((state) =>
    state.files.find((file) => file.id === state.selectedFileId),
  );
}
