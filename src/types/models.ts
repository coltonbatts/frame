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
  thumbnailPath?: string;
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
  warnings: string[];
}

export interface ProjectFile {
  id: string;
  folder: ProjectFolder;
  name: string;
  path: string;
  localPath?: string;
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
  errorMessage?: string;
}

export interface CaptureHdFrameRequest {
  videoPath: string;
  time: number;
  outputDir?: string;
}

export interface CapturedFrame {
  outputPath: string;
  outputDir: string;
  fileName: string;
  timestamp: number;
  timecode: string;
  width: number;
  height: number;
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

export interface ShotItem {
  shotNumber: number;
  timestampSeconds: number;
  timestampReadable: string;
  sceneLabel: string;
  thumbnailName: string;
  thumbnailPath: string;
}

export interface ShotListState {
  videoPath: string;
  sidecarPath: string;
  outputDir: string;
  manifestJsonPath: string;
  manifestCsvPath: string;
  shots: ShotItem[];
}

export type SourceType =
  | 'YouTube'
  | 'Stock'
  | 'Internal Brand Asset'
  | 'Frame.io / Editorial Export'
  | 'Unknown'
  | 'Other';

export type ReviewStatus = 'unreviewed' | 'reviewed' | 'adjusted';

export interface ShotRecord {
  id: string;
  videoName: string;
  startTimeSec: number;
  endTimeSec: number;
  startTimecode?: string;
  endTimecode?: string;
  thumbnailPath?: string;
  thumbnailFrameSec?: number;
  description?: string;
  sourceType?: SourceType;
  sourceName?: string;
  sourceReference?: string;
  notes?: string;
  detectionConfidence?: number;
  reviewStatus?: ReviewStatus;
}

export interface ProvenanceState {
  videoPath: string;
  videoName: string;
  videoDurationSec: number;
  analyzedAt: string;
  sceneThreshold: number;
  outputDir: string;
  thumbnailDir: string;
  sidecarPath: string;
  csvPath: string;
  shots: ShotRecord[];
  warnings: string[];
}

export interface AnalyzeProvenanceRequest {
  path: string;
  sensitivity: number;
}

export interface UpdateProvenanceShotRequest {
  videoPath: string;
  shot: ShotRecord;
}

export interface DeleteProvenanceShotRequest {
  videoPath: string;
  shotId: string;
}
