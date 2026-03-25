import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Pause,
  PictureInPicture2,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { formatDuration, formatResolution, formatSmpte } from '../../lib/format';
import { alignTimeToVideo, getFrameDuration } from '../../lib/video-time';
import type { ProjectFile } from '../../types/models';

interface VideoPreviewProps {
  file?: ProjectFile;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  onTimeChange: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onTogglePlay: () => void;
  onStepFrame: (direction: -1 | 1) => void;
  onJump: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onMutedChange: (muted: boolean) => void;
}

export function VideoPreview({
  file,
  currentTime,
  duration,
  isPlaying,
  volume,
  muted,
  onTimeChange,
  onDurationChange,
  onPlayingChange,
  onTogglePlay,
  onStepFrame,
  onJump,
  onVolumeChange,
  onMutedChange,
}: VideoPreviewProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fps = file?.fps ?? 24;
  const scrubberMax = duration || file?.duration || 1;
  const frameDuration = getFrameDuration(fps);
  const scrubberTime = alignTimeToVideo(currentTime, fps, scrubberMax);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.volume = muted ? 0 : volume;

    if (file?.sourceUrl) {
      video.src = file.sourceUrl;
    } else {
      video.removeAttribute('src');
      video.load();
    }
  }, [file?.sourceUrl, muted, volume]);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (!Number.isFinite(video.currentTime) || Math.abs(video.currentTime - currentTime) > 0.001) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (!file?.sourceUrl) {
      return;
    }

    if (isPlaying) {
      void video.play().catch(() => onPlayingChange(false));
    } else {
      video.pause();
    }
  }, [file?.sourceUrl, isPlaying, onPlayingChange]);

  const badgeText = useMemo(() => {
    if (!file) {
      return 'Drop a file to preview';
    }

    return `${formatResolution(file.width, file.height)} • ${file.codec}`;
  }, [file]);

  const heroSubtitle = file
    ? `${formatDuration(scrubberMax)} total • ${fps.toFixed(2)} fps`
    : 'Drop a clip to start inspecting picture, audio, and metadata.';

  return (
    <section className="panel panel-preview panel-preview-hero">
      <div className="hero-preview-header">
        <div className="hero-preview-copy">
          <p className="panel-kicker">Video Preview</p>
          <h2 className="panel-title">{file?.name ?? 'Drop a file to begin'}</h2>
          <p className="hero-preview-subtitle">{heroSubtitle}</p>
        </div>
        <div className="hero-preview-meta">
          <span className="info-pill">{badgeText}</span>
          <span className="info-pill info-pill-muted">
            {formatSmpte(scrubberTime, fps)}
          </span>
        </div>
      </div>

      <div className="preview-stage" ref={stageRef}>
        {file?.sourceUrl ? (
          <video
            ref={videoRef}
            className="preview-video"
            playsInline
            onClick={onTogglePlay}
            onTimeUpdate={(event) => {
              const { currentTime: nextTime, paused, seeking } = event.currentTarget;
              if (paused || seeking) {
                onTimeChange(alignTimeToVideo(nextTime, fps, scrubberMax));
                return;
              }

              onTimeChange(nextTime);
            }}
            onLoadedMetadata={(event) => onDurationChange(event.currentTarget.duration)}
            onPlay={() => onPlayingChange(true)}
            onPause={() => onPlayingChange(false)}
          />
        ) : (
          <div
            className="preview-placeholder"
            style={{
              background: `radial-gradient(circle at top left, ${file?.thumbnailColor ?? '#6366F1'}, #09090b 55%)`,
            }}
          >
            <button className="preview-play-button" type="button" onClick={onTogglePlay}>
              {isPlaying ? <Pause size={26} /> : <Play size={26} />}
            </button>
            <div className="preview-placeholder-copy">
              <span className="preview-placeholder-eyebrow">Main view</span>
              <h3>Load a clip and the hero stage will light up here.</h3>
              <p>
                The preview is now the focal point. Supporting tools live below it.
              </p>
            </div>
          </div>
        )}
        <div className="preview-overlay">
          <span className="overlay-pill">{file?.name ?? 'Awaiting source'}</span>
          <span className="overlay-pill">{formatDuration(scrubberMax)}</span>
        </div>
      </div>

      <div className="transport">
        <div className="transport-topline">
          <button className="transport-main" type="button" onClick={onTogglePlay}>
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="transport-button" type="button" onClick={() => onJump(-5)}>
            -5s
          </button>
          <button
            className="transport-button transport-button-frame"
            type="button"
            onClick={() => onStepFrame(-1)}
            aria-label="Step backward one frame"
            title="Step backward one frame"
          >
            <ChevronLeft size={15} />
            1f
          </button>
          <button
            className="transport-button transport-button-frame"
            type="button"
            onClick={() => onStepFrame(1)}
            aria-label="Step forward one frame"
            title="Step forward one frame"
          >
            1f
            <ChevronRight size={15} />
          </button>
          <button className="transport-button" type="button" onClick={() => onJump(5)}>
            +5s
          </button>
          <div className="transport-scrubber">
            <input
              aria-label="Scrub timeline"
              type="range"
              min={0}
              max={scrubberMax}
              step={frameDuration}
              value={scrubberTime}
              onChange={(event) => {
                onPlayingChange(false);
                onTimeChange(alignTimeToVideo(Number(event.target.value), fps, scrubberMax));
              }}
            />
          </div>
          <span className="transport-time">
            {formatSmpte(scrubberTime, fps)} / {formatSmpte(scrubberMax, fps)}
          </span>
        </div>

        <div className="transport-footer">
          <div className="transport-volume">
            <button className="transport-button" type="button" onClick={() => onMutedChange(!muted)}>
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              aria-label="Volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
            />
          </div>
          <div className="transport-actions">
            <button className="transport-button" type="button">
              <PictureInPicture2 size={16} />
              PiP
            </button>
            <button
              className="transport-button"
              type="button"
              onClick={() => void stageRef.current?.requestFullscreen?.()}
            >
              <Maximize2 size={16} />
              Fullscreen
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
