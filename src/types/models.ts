export type FileState =
  | 'idle'
  | 'analyzing'
  | 'queued'
  | 'processing'
  | 'done'
  | 'error';

export type QueueState =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'paused'
  | 'done'
  | 'error';

export type ProjectFolder = 'raw' | 'export';
export type TranscriptExportFormat = 'txt' | 'srt' | 'vtt';
export type AnalysisSectionKey = 'scenes' | 'palette' | 'audio' | 'tags';

export interface Scene {
  index: number;
  startTime: number;
  endTime: number;
  confidence: number;
  thumbnailColor: string;
}

export interface TranscriptSegment {
  id: string;
  startTime: number;
  endTime: number;
  speaker: string;
  text: string;
}

export interface AnalysisResult {
  scenes: Scene[];
  palette: string[];
  mood: string[];
  transcript: TranscriptSegment[];
  language: string;
  audioWaveform: number[];
  processedAt: string;
}

export interface ProjectFile {
  id: string;
  folder: ProjectFolder;
  name: string;
  path: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  codec: string;
  fps: number;
  state: FileState;
  progress?: number;
  thumbnailColor: string;
  tags: string[];
  analysis?: AnalysisResult;
  sourceUrl?: string;
  outputPath?: string;
}

export interface ExportPreset {
  id: string;
  name: string;
  container: 'mp4' | 'mov' | 'webm' | 'mkv';
  videoCodec: 'h264' | 'h265' | 'vp9' | 'prores';
  audioCodec: 'aac' | 'opus' | 'pcm';
  bitrate?: string;
  resolution?: string;
  fps?: number;
}

export interface QueueItem {
  id: string;
  fileId: string;
  preset: ExportPreset;
  progress: number;
  state: QueueState;
  eta: string;
  outputPath?: string;
  error?: string;
}
