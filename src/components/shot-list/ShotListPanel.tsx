import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Archive,
  Camera,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Image,
  Trash2,
} from 'lucide-react';
import type { ProjectFile, ShotItem, ShotListState } from '../../types/models';

interface ShotListPanelProps {
  file?: ProjectFile;
  shotList: ShotListState | null;
  collapsed: boolean;
  busy: boolean;
  exporting: boolean;
  error: string | null;
  message: string | null;
  hotkeyHint: string;
  onToggleCollapsed: () => void;
  onCapture: () => void | Promise<void>;
  onExportZip: () => void | Promise<void>;
  onChooseFolder: () => void | Promise<void>;
  onSeek: (time: number) => void;
  onLabelChange: (shotNumber: number, sceneLabel: string) => void | Promise<void>;
  onDelete: (shotNumber: number) => void | Promise<void>;
}

interface ShotCardProps {
  shot: ShotItem;
  disabled: boolean;
  onSeek: (time: number) => void;
  onLabelChange: (shotNumber: number, sceneLabel: string) => void | Promise<void>;
  onDelete: (shotNumber: number) => void | Promise<void>;
}

function ShotCard({
  shot,
  disabled,
  onSeek,
  onLabelChange,
  onDelete,
}: ShotCardProps): JSX.Element {
  const thumbnailUrl = convertFileSrc(shot.thumbnailPath);

  return (
    <article className="shot-card">
      <button
        className="shot-card-thumb-button"
        type="button"
        onClick={() => onSeek(shot.timestampSeconds)}
      >
        <img
          className="shot-card-thumb"
          src={thumbnailUrl}
          alt={`Shot ${shot.shotNumber} at ${shot.timestampReadable}`}
          loading="lazy"
        />
      </button>

      <div className="shot-card-body">
        <div className="shot-card-header">
          <button className="shot-card-jump" type="button" onClick={() => onSeek(shot.timestampSeconds)}>
            <strong>Shot {shot.shotNumber.toString().padStart(3, '0')}</strong>
            <span>{shot.timestampReadable}</span>
          </button>
          <button
            className="toolbar-icon-button shot-card-delete"
            type="button"
            aria-label={`Delete shot ${shot.shotNumber}`}
            onClick={() => void onDelete(shot.shotNumber)}
            disabled={disabled}
          >
            <Trash2 size={14} />
          </button>
        </div>

        <label className="shot-card-label">
          <span className="sr-only">Scene label</span>
          <input
            type="text"
            defaultValue={shot.sceneLabel}
            placeholder="Scene label"
            disabled={disabled}
            onBlur={(event) => {
              const nextLabel = event.target.value.trim();
              if (nextLabel !== shot.sceneLabel) {
                void onLabelChange(shot.shotNumber, nextLabel);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }

              if (event.key === 'Escape') {
                event.currentTarget.value = shot.sceneLabel;
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      </div>
    </article>
  );
}

export function ShotListPanel({
  file,
  shotList,
  collapsed,
  busy,
  exporting,
  error,
  message,
  hotkeyHint,
  onToggleCollapsed,
  onCapture,
  onExportZip,
  onChooseFolder,
  onSeek,
  onLabelChange,
  onDelete,
}: ShotListPanelProps): JSX.Element {
  const hasVideo = Boolean(file && file.width > 0 && file.height > 0);
  const shotCount = shotList?.shots.length ?? 0;
  const exportDisabled = exporting || shotCount === 0;
  const captureDisabled = busy || !hasVideo;

  return (
    <aside className={`panel panel-shot-list ${collapsed ? 'panel-collapsed' : ''}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Review</p>
          <h2 className="panel-title">Shot List</h2>
        </div>
        <div className="panel-header-actions">
          <button
            className="toolbar-icon-button"
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand shot list' : 'Collapse shot list'}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="shot-list-toolbar">
            <button
              className="toolbar-button toolbar-button-primary"
              type="button"
              onClick={() => void onCapture()}
              disabled={captureDisabled}
            >
              <Camera size={14} />
              {busy ? 'Working…' : 'Capture Shot'}
            </button>
            <button
              className="toolbar-button"
              type="button"
              onClick={() => void onChooseFolder()}
              disabled={!file}
            >
              <FolderOpen size={14} />
              Folder
            </button>
            <button
              className="toolbar-button"
              type="button"
              onClick={() => void onExportZip()}
              disabled={exportDisabled}
            >
              <Archive size={14} />
              {exporting ? 'Exporting…' : 'Export ZIP'}
            </button>
          </div>

          <div className="shot-list-summary">
            <span className="info-pill">
              <Image size={12} />
              {shotCount} {shotCount === 1 ? 'shot' : 'shots'}
            </span>
            <span className="info-pill info-pill-muted">Capture {hotkeyHint}</span>
          </div>

          {shotList && (
            <div className="shot-list-paths">
              <p className="shot-list-path-label">Output folder</p>
              <p className="shot-list-path-value">{shotList.outputDir}</p>
            </div>
          )}

          {error && <p className="shot-list-feedback shot-list-feedback-error">{error}</p>}
          {message && <p className="shot-list-feedback">{message}</p>}

          {!file && <p className="empty-copy shot-list-empty">Select a clip to capture shot thumbnails.</p>}
          {file && !hasVideo && (
            <p className="empty-copy shot-list-empty">Shot capture is only available for files with a video track.</p>
          )}
          {file && hasVideo && shotCount === 0 && !error && (
            <p className="empty-copy shot-list-empty">
              Capture frames at cut points and Frame will build a numbered shot list with manifests alongside them.
            </p>
          )}

          {shotCount > 0 && shotList && (
            <div className="shot-list-grid">
              {shotList.shots.map((shot) => (
                <ShotCard
                  key={`${shot.thumbnailPath}:${shot.sceneLabel}`}
                  shot={shot}
                  disabled={busy || exporting}
                  onSeek={onSeek}
                  onLabelChange={onLabelChange}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
