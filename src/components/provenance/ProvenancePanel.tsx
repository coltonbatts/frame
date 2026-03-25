import { convertFileSrc } from '@tauri-apps/api/core';
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Image,
  Layers3,
  ListChecks,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatResolution, formatSmpte } from '../../lib/format';
import type { ProjectFile, ProvenanceState, ShotRecord, SourceType } from '../../types/models';

const SOURCE_TYPES: SourceType[] = [
  'YouTube',
  'Stock',
  'Internal Brand Asset',
  'Frame.io / Editorial Export',
  'Unknown',
  'Other',
];

interface ProvenancePanelProps {
  file?: ProjectFile;
  provenance: ProvenanceState | null;
  selectedShotId: string | null;
  collapsed: boolean;
  busy: boolean;
  error: string | null;
  message: string | null;
  sensitivity: number;
  onToggleCollapsed: () => void;
  onAnalyze: () => void | Promise<void>;
  onSensitivityChange: (value: number) => void;
  onSelectShot: (shotId: string) => void;
  onSeek: (time: number) => void;
  onUpdateShot: (shot: ShotRecord) => void | Promise<void>;
  onDeleteShot: (shotId: string) => void | Promise<void>;
  onOpenDataFolder: () => void | Promise<void>;
  onOpenThumbnails: () => void | Promise<void>;
  onExportCsv: () => void | Promise<void>;
  onExportJson: () => void | Promise<void>;
}

function formatAnalysisTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function buildShotUpdate(shot: ShotRecord, patch: Partial<ShotRecord>): ShotRecord {
  return {
    ...shot,
    ...patch,
  };
}

function ShotCard({
  shot,
  selected,
  fps,
  onSelect,
  onSeek,
  onDelete,
}: {
  shot: ShotRecord;
  selected: boolean;
  fps: number;
  onSelect: (shotId: string) => void;
  onSeek: (time: number) => void;
  onDelete: (shotId: string) => void | Promise<void>;
}): JSX.Element {
  const thumbnailUrl = shot.thumbnailPath ? convertFileSrc(shot.thumbnailPath) : null;
  const timeRange = `${formatSmpte(shot.startTimeSec, fps)} - ${formatSmpte(shot.endTimeSec, fps)}`;
  const reviewStatus = shot.reviewStatus ?? 'unreviewed';

  return (
    <article className={`provenance-shot-card ${selected ? 'provenance-shot-card-selected' : ''}`}>
      <button
        className="provenance-shot-main"
        type="button"
        onClick={() => onSelect(shot.id)}
        aria-pressed={selected}
      >
        <span
          className="provenance-shot-thumb"
          style={
            thumbnailUrl
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(15, 23, 42, 0.12), rgba(15, 23, 42, 0.58)), url(${thumbnailUrl})`,
                  backgroundPosition: 'center',
                  backgroundSize: 'cover',
                }
              : undefined
          }
        >
          {!thumbnailUrl && <Image size={14} />}
        </span>

        <span className="provenance-shot-copy">
          <span className="provenance-shot-header">
            <strong>{shot.id.replace(/^shot-/, 'Shot ')}</strong>
            <span className="provenance-shot-status">{reviewStatus}</span>
          </span>
          <span className="provenance-shot-time">{timeRange}</span>
          <span className="provenance-shot-meta">
            {Math.round(shot.detectionConfidence ?? 0)}% confidence
          </span>
        </span>
      </button>

      <span className="provenance-shot-actions">
        <button
          className="toolbar-icon-button"
          type="button"
          aria-label={`Jump to ${shot.id}`}
          onClick={(event) => {
            event.stopPropagation();
            onSeek(shot.startTimeSec);
          }}
        >
          <Layers3 size={14} />
        </button>
        <button
          className="toolbar-icon-button provenance-shot-delete"
          type="button"
          aria-label={`Delete ${shot.id}`}
          onClick={(event) => {
            event.stopPropagation();
            void onDelete(shot.id);
          }}
        >
          <Trash2 size={14} />
        </button>
      </span>
    </article>
  );
}

function ShotEditor({
  shot,
  onSeek,
  onUpdateShot,
  onDeleteShot,
}: {
  shot: ShotRecord;
  onSeek: (time: number) => void;
  onUpdateShot: (shot: ShotRecord) => void | Promise<void>;
  onDeleteShot: (shotId: string) => void | Promise<void>;
}): JSX.Element {
  const thumbnailUrl = shot.thumbnailPath ? convertFileSrc(shot.thumbnailPath) : null;
  const sourceType = shot.sourceType ?? 'Unknown';
  const reviewStatus = shot.reviewStatus ?? 'unreviewed';

  const commit = async (patch: Partial<ShotRecord>): Promise<void> => {
    await onUpdateShot(buildShotUpdate(shot, patch));
  };

  return (
    <section className="provenance-editor">
      <div className="provenance-editor-preview">
        {thumbnailUrl ? (
          <img className="provenance-editor-image" src={thumbnailUrl} alt={shot.id} />
        ) : (
          <div className="provenance-editor-placeholder">
            <Image size={20} />
          </div>
        )}
      </div>

      <div className="provenance-editor-copy">
        <div className="provenance-editor-header">
          <div>
            <p className="panel-kicker">Selected Shot</p>
            <h3>{shot.id.replace(/^shot-/, 'Shot ')}</h3>
          </div>
          <span className="info-pill info-pill-muted">{reviewStatus}</span>
        </div>

        <div className="provenance-editor-grid">
          <label className="provenance-field">
            <span>Start Time (sec)</span>
            <input
              type="number"
              min={0}
              step={0.01}
              defaultValue={shot.startTimeSec}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value) && value !== shot.startTimeSec) {
                  void commit({ startTimeSec: value, reviewStatus: 'adjusted' });
                }
              }}
            />
          </label>

          <label className="provenance-field">
            <span>End Time (sec)</span>
            <input
              type="number"
              min={0}
              step={0.01}
              defaultValue={shot.endTimeSec}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value) && value !== shot.endTimeSec) {
                  void commit({ endTimeSec: value, reviewStatus: 'adjusted' });
                }
              }}
            />
          </label>

          <label className="provenance-field">
            <span>Source Type</span>
            <select
              defaultValue={sourceType}
              onChange={(event) => {
                void commit({
                  sourceType: event.currentTarget.value as SourceType,
                  reviewStatus: reviewStatus === 'reviewed' ? 'reviewed' : 'adjusted',
                });
              }}
            >
              {SOURCE_TYPES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <label className="provenance-field">
            <span>Source Name</span>
            <input
              type="text"
              defaultValue={shot.sourceName ?? ''}
              placeholder="Source name"
              onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                if (value !== (shot.sourceName ?? '')) {
                  void commit({
                    sourceName: value,
                    reviewStatus: reviewStatus === 'reviewed' ? 'reviewed' : 'adjusted',
                  });
                }
              }}
            />
          </label>

          <label className="provenance-field provenance-field-wide">
            <span>Source Reference</span>
            <input
              type="text"
              defaultValue={shot.sourceReference ?? ''}
              placeholder="URL, asset ID, or note"
              onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                if (value !== (shot.sourceReference ?? '')) {
                  void commit({
                    sourceReference: value,
                    reviewStatus: reviewStatus === 'reviewed' ? 'reviewed' : 'adjusted',
                  });
                }
              }}
            />
          </label>

          <label className="provenance-field provenance-field-wide">
            <span>Description</span>
            <input
              type="text"
              defaultValue={shot.description ?? ''}
              placeholder="Description placeholder"
              onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                if (value !== (shot.description ?? '')) {
                  void commit({
                    description: value,
                    reviewStatus: reviewStatus === 'reviewed' ? 'reviewed' : 'adjusted',
                  });
                }
              }}
            />
          </label>

          <label className="provenance-field provenance-field-wide">
            <span>Notes</span>
            <textarea
              defaultValue={shot.notes ?? ''}
              placeholder="Notes placeholder"
              rows={3}
              onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                if (value !== (shot.notes ?? '')) {
                  void commit({
                    notes: value,
                    reviewStatus: reviewStatus === 'reviewed' ? 'reviewed' : 'adjusted',
                  });
                }
              }}
            />
          </label>
        </div>

        <div className="provenance-editor-actions">
          <button className="toolbar-button" type="button" onClick={() => onSeek(shot.startTimeSec)}>
            <Layers3 size={14} />
            Seek
          </button>
          <button
            className="toolbar-button"
            type="button"
            onClick={() => {
              void commit({ reviewStatus: 'reviewed' });
            }}
          >
            <ListChecks size={14} />
            Mark Reviewed
          </button>
          <button
            className="toolbar-button"
            type="button"
            onClick={() => void onDeleteShot(shot.id)}
          >
            <Trash2 size={14} />
            Delete Shot
          </button>
        </div>
      </div>
    </section>
  );
}

export function ProvenancePanel({
  file,
  provenance,
  selectedShotId,
  collapsed,
  busy,
  error,
  message,
  sensitivity,
  onToggleCollapsed,
  onAnalyze,
  onSensitivityChange,
  onSelectShot,
  onSeek,
  onUpdateShot,
  onDeleteShot,
  onOpenDataFolder,
  onOpenThumbnails,
  onExportCsv,
  onExportJson,
}: ProvenancePanelProps): JSX.Element {
  const [analysisActionPending, setAnalysisActionPending] = useState(false);
  const fps = file?.fps ?? 24;
  const selectedShot = useMemo(
    () => provenance?.shots.find((shot) => shot.id === selectedShotId) ?? provenance?.shots[0],
    [provenance, selectedShotId],
  );

  const hasFile = Boolean(file && file.width > 0 && file.height > 0);
  const shotCount = provenance?.shots.length ?? 0;
  const hasOutput = Boolean(provenance);
  const analyzeDisabled = busy || analysisActionPending || !hasFile;

  const handleAnalyze = async (): Promise<void> => {
    if (analyzeDisabled) {
      return;
    }

    setAnalysisActionPending(true);
    try {
      await onAnalyze();
    } finally {
      setAnalysisActionPending(false);
    }
  };

  return (
    <aside className={`panel panel-provenance ${collapsed ? 'panel-collapsed' : ''}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Provenance</p>
          <h2 className="panel-title">Shot List</h2>
        </div>
        <div className="panel-header-actions">
          <button className="toolbar-icon-button" type="button" onClick={() => void handleAnalyze()}>
            {busy || analysisActionPending ? <RefreshCw size={14} className="spin" /> : <ListChecks size={14} />}
          </button>
          <button className="toolbar-icon-button" type="button" onClick={onToggleCollapsed}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="provenance-toolbar">
            <button
              className="toolbar-button toolbar-button-primary"
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={analyzeDisabled}
            >
              {busy || analysisActionPending ? 'Analyzing…' : 'Analyze Cuts'}
            </button>
            <button
              className="toolbar-button"
              type="button"
              onClick={() => void onOpenDataFolder()}
              disabled={!hasOutput}
            >
              <FolderOpen size={14} />
              Data
            </button>
            <button
              className="toolbar-button"
              type="button"
              onClick={() => void onOpenThumbnails()}
              disabled={!hasOutput}
            >
              <Image size={14} />
              Thumbs
            </button>
            <button
              className="toolbar-button"
              type="button"
              onClick={() => void onExportCsv()}
              disabled={!hasOutput}
            >
              CSV
            </button>
            <button
              className="toolbar-button"
              type="button"
              onClick={() => void onExportJson()}
              disabled={!hasOutput}
            >
              JSON
            </button>
          </div>

          <div className="provenance-summary">
            <span className="info-pill">
              <ListChecks size={12} />
              {shotCount} {shotCount === 1 ? 'shot' : 'shots'}
            </span>
            <span className="info-pill info-pill-muted">
              {formatResolution(file?.width ?? 0, file?.height ?? 0)}
            </span>
            <span className="info-pill info-pill-muted">
              Sensitivity {sensitivity}
            </span>
          </div>

          {file ? (
            <div className="provenance-file-card">
              <div>
                <p className="provenance-file-label">Selected video</p>
                <strong>{file.name}</strong>
                <p>
                  {formatResolution(file.width, file.height)} • {formatSmpte(file.duration, file.fps)}
                </p>
              </div>
              <button
                className="toolbar-button"
                type="button"
                onClick={() => void handleAnalyze()}
                disabled={analyzeDisabled}
              >
                {busy || analysisActionPending ? 'Working…' : 'Run Analysis'}
              </button>
            </div>
          ) : (
            <div className="provenance-dropzone">
              <p className="panel-kicker">Drop Zone</p>
              <strong>Drop an MP4 into Frame, then analyze cuts locally.</strong>
              <p>Frame will detect likely shot boundaries, extract one thumbnail per shot, and write a local CSV/JSON sidecar.</p>
            </div>
          )}

          <div className="provenance-slider-row">
            <label className="analysis-slider">
              <span>Scene Sensitivity</span>
              <input
                type="range"
                min={1}
                max={100}
                value={sensitivity}
                onChange={(event) => onSensitivityChange(Number(event.target.value))}
              />
              <strong>{sensitivity}</strong>
            </label>
          </div>

          {error && <p className="provenance-feedback provenance-feedback-error">{error}</p>}
          {message && <p className="provenance-feedback">{message}</p>}

          {provenance?.warnings.length ? (
            <div className="analysis-warning-list provenance-warning-list">
              {provenance.warnings.map((warning) => (
                <span key={warning} className="info-pill info-pill-muted">
                  {warning}
                </span>
              ))}
            </div>
          ) : null}

          {selectedShot && provenance ? (
            <ShotEditor
              key={selectedShot.id}
              shot={selectedShot}
              onSeek={onSeek}
              onUpdateShot={onUpdateShot}
              onDeleteShot={onDeleteShot}
            />
          ) : null}

          {provenance ? (
            <div className="provenance-metadata">
              <span>
                Analyzed {formatAnalysisTime(provenance.analyzedAt)}
              </span>
              <span>{provenance.outputDir}</span>
            </div>
          ) : null}

          <div className="provenance-list">
            {!provenance && file ? (
              <p className="empty-copy provenance-empty">No provenance shot list yet. Click Analyze Cuts to generate one.</p>
            ) : null}

            {provenance?.shots.map((shot) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                selected={shot.id === selectedShot?.id}
                fps={fps}
                onSelect={onSelectShot}
                onSeek={onSeek}
                onDelete={onDeleteShot}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
