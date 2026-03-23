import type {
  AnalysisResult,
  ExportPreset,
  ProjectFile,
  QueueItem,
  Scene,
  TranscriptSegment,
} from '../types/models';

const paletteFamilies = [
  ['#818CF8', '#4F46E5', '#1E1B4B', '#EAB308', '#F8FAFC', '#4338CA', '#0F172A', '#22C55E'],
  ['#FB7185', '#F97316', '#FACC15', '#111827', '#E5E7EB', '#EF4444', '#22D3EE', '#0F172A'],
  ['#34D399', '#0F766E', '#155E75', '#F8FAFC', '#0D0D0F', '#14B8A6', '#A7F3D0', '#334155'],
];

const moodFamilies = [
  ['cool', 'high contrast', 'studio-lit'],
  ['warm', 'documentary', 'sun-baked'],
  ['desaturated', 'night interior', 'moody'],
];

const transcriptPresets = [
  [
    'We keep everything local so the rough cut stays on this machine.',
    'Mark the dialogue-heavy segments and send the rest through the H.265 preset.',
    'Scene eleven needs another pass; the contrast breaks hard at the cut.',
  ],
  [
    'This take is clean enough for an overnight transcript run.',
    'Drop a chapter marker at the B-roll transition and keep the interview audio intact.',
    'Export the social cut after the subtitles land.',
  ],
  [
    'The palette leans colder than the previous scene, but the exposure is stable.',
    'Queue the master file once the transcript and tag pass finishes.',
    'If the waveform stays balanced, this mix is ready for review.',
  ],
];

function stringToSeed(value: string): number {
  return Array.from(value).reduce(
    (accumulator, character, index) =>
      accumulator + character.charCodeAt(0) * (index + 17),
    0,
  );
}

function createScenes(duration: number, seed: number): Scene[] {
  const count = Math.max(4, Math.min(9, Math.round(duration / 55)));
  const sceneLength = Math.max(duration / count, 12);

  return Array.from({ length: count }, (_, index) => {
    const startTime = index * sceneLength;
    const variance = (seed % 7) + index * 2.3;
    const endTime = Math.min(duration, startTime + sceneLength - variance);

    return {
      index: index + 1,
      startTime,
      endTime: Math.max(startTime + 4, endTime),
      confidence: 72 + ((seed + index * 13) % 24),
      thumbnailColor: paletteFamilies[seed % paletteFamilies.length][index % 4],
    };
  });
}

function createTranscript(seed: number, duration: number): TranscriptSegment[] {
  const preset = transcriptPresets[seed % transcriptPresets.length];
  const spacing = Math.max(duration / (preset.length + 1), 12);

  return preset.map((text, index) => ({
    id: `segment-${seed}-${index}`,
    startTime: spacing * index + 2,
    endTime: spacing * index + 10,
    speaker: index % 2 === 0 ? 'A' : 'B',
    text,
  }));
}

function createWaveform(seed: number): number[] {
  return Array.from({ length: 32 }, (_, index) => {
    const base = ((seed + index * 29) % 80) + 18;
    return Math.min(100, base);
  });
}

export function createAnalysisSeed(
  name: string,
  duration: number,
): {
  analysis: AnalysisResult;
  tags: string[];
  thumbnailColor: string;
} {
  const seed = stringToSeed(name);
  const palette = paletteFamilies[seed % paletteFamilies.length];
  const analysis: AnalysisResult = {
    scenes: createScenes(duration, seed),
    palette,
    mood: moodFamilies[seed % moodFamilies.length],
    transcript: createTranscript(seed, duration),
    language: 'EN',
    audioWaveform: createWaveform(seed),
    processedAt: new Date().toISOString(),
  };

  return {
    analysis,
    tags: analysis.mood.slice(0, 2).concat(seed % 2 === 0 ? 'dialogue' : 'b-roll'),
    thumbnailColor: palette[0],
  };
}

export const defaultPreset: ExportPreset = {
  id: 'preset-h265-4k',
  name: 'H.265 4K',
  container: 'mp4',
  videoCodec: 'h265',
  audioCodec: 'aac',
  bitrate: '14M',
  resolution: '3840x2160',
  fps: 24,
};

const sourceSeeds = [
  {
    name: 'interview_master.mov',
    duration: 725,
    size: 2_500_000_000,
    width: 3840,
    height: 2160,
    codec: 'ProRes',
    fps: 23.98,
  },
  {
    name: 'street_broll.mp4',
    duration: 183,
    size: 875_000_000,
    width: 1920,
    height: 1080,
    codec: 'H.264',
    fps: 29.97,
  },
  {
    name: 'podcast_take_a.mp4',
    duration: 1445,
    size: 1_300_000_000,
    width: 3840,
    height: 2160,
    codec: 'H.265',
    fps: 30,
  },
];

export const mockFiles: ProjectFile[] = sourceSeeds.map((seed, index) => {
  const analysisSeed = createAnalysisSeed(seed.name, seed.duration);

  return {
    id: `raw-${index + 1}`,
    folder: 'raw',
    name: seed.name,
    path: `/Volumes/Projects/Frame/${seed.name}`,
    size: seed.size,
    duration: seed.duration,
    width: seed.width,
    height: seed.height,
    codec: seed.codec,
    fps: seed.fps,
    state: index === 0 ? 'processing' : 'idle',
    progress: index === 0 ? 67 : undefined,
    thumbnailColor: analysisSeed.thumbnailColor,
    tags: analysisSeed.tags,
    analysis: analysisSeed.analysis,
  };
});

export const mockExport: ProjectFile = {
  id: 'export-1',
  folder: 'export',
  name: 'interview_master_h265.mp4',
  path: '/Volumes/Projects/Frame/Exports/interview_master_h265.mp4',
  size: 840_000_000,
  duration: 725,
  width: 3840,
  height: 2160,
  codec: 'H.265',
  fps: 23.98,
  state: 'done',
  thumbnailColor: '#22C55E',
  tags: ['export', 'reviewed'],
  outputPath: '/Volumes/Projects/Frame/Exports/interview_master_h265.mp4',
};

export const mockQueue: QueueItem[] = [
  {
    id: 'queue-1',
    fileId: 'raw-1',
    preset: defaultPreset,
    progress: 34,
    state: 'processing',
    eta: '03:24',
    outputPath: '/Volumes/Projects/Frame/Exports/interview_master_h265.mp4',
  },
  {
    id: 'queue-2',
    fileId: 'raw-2',
    preset: defaultPreset,
    progress: 0,
    state: 'queued',
    eta: '12:10',
  },
];
