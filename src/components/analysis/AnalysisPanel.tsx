import { convertFileSrc } from '@tauri-apps/api/core';
import {
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  Languages as LanguagesIcon,
  ScanLine as ScanLineIcon,
  SlidersHorizontal as SlidersHorizontalIcon,
} from 'lucide-react';
import { useState } from 'react';
import { formatSmpte } from '../../lib/format';
import type {
  AnalysisSectionKey,
  ProjectFile,
  TranscriptExportFormat,
} from '../../types/models';

interface AnalysisPanelProps {
  file?: ProjectFile;
  sections: Record<AnalysisSectionKey, boolean>;
  sensitivity: number;
  transcriptFormat: TranscriptExportFormat;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onToggleSection: (key: AnalysisSectionKey) => void;
  onSensitivityChange: (value: number) => void;
  onSeek: (time: number) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onTranscriptFormatChange: (format: TranscriptExportFormat) => void;
  onProcess: () => void | Promise<void>;
}

function Section({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: JSX.Element;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="analysis-section">
      <button className="analysis-section-toggle" type="button" onClick={onToggle}>
        <span className="analysis-section-title">
          {icon}
          {title}
        </span>
        {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
      </button>
      {open && <div className="analysis-section-body">{children}</div>}
    </section>
  );
}

export function AnalysisPanel({
  file,
  sections,
  sensitivity,
  transcriptFormat,
  collapsed,
  onToggleCollapsed,
  onToggleSection,
  onSensitivityChange,
  onSeek,
  onAddTag,
  onRemoveTag,
  onTranscriptFormatChange,
  onProcess,
}: AnalysisPanelProps): JSX.Element {
  const [draftTag, setDraftTag] = useState('');
  const analysis = file?.analysis;
  const canProcess = Boolean(
    file &&
      file.folder === 'raw' &&
      !['analyzing', 'queued', 'processing'].includes(file.state),
  );
  const processLabel = file?.state === 'analyzing' ? 'Processing...' : 'Process';

  return (
    <aside className={`panel panel-analysis ${collapsed ? 'panel-collapsed' : ''}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Analysis</p>
          <h2 className="panel-title">Clip Intelligence</h2>
        </div>
        <div className="panel-header-actions">
          <button className="toolbar-icon-button" type="button">
            <ScanLineIcon size={14} />
          </button>
          <button className="toolbar-icon-button" type="button">
            <SlidersHorizontalIcon size={14} />
          </button>
          <button className="toolbar-icon-button" type="button" onClick={onToggleCollapsed}>
            {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="analysis-toolbar">
            <button
              className="toolbar-button toolbar-button-primary"
              type="button"
              onClick={() => void onProcess()}
              disabled={!canProcess}
            >
              {processLabel}
            </button>
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

          {!file && <p className="empty-copy">Select a file and click Process.</p>}
          {file?.state === 'analyzing' && (
            <p className="empty-copy">Running local analysis on this file.</p>
          )}
          {file?.errorMessage && <p className="empty-copy">{file.errorMessage}</p>}
          {file && !analysis && file.state === 'idle' && (
            <p className="empty-copy">Click Process to run local analysis on this file.</p>
          )}

          {analysis && (
            <>
              {analysis.warnings.length > 0 && (
                <div className="analysis-warning-list">
                  {analysis.warnings.map((warning) => (
                    <span key={warning} className="info-pill info-pill-muted">
                      {warning}
                    </span>
                  ))}
                </div>
              )}

              <Section
                title="Scene Detection"
                icon={<ScanLineIcon size={14} />}
                open={sections.scenes}
                onToggle={() => onToggleSection('scenes')}
              >
                {analysis.scenes.length === 0 ? (
                  <p className="empty-copy">No video scenes were detected for this file.</p>
                ) : (
                  <div className="scene-list">
                    {analysis.scenes.map((scene) => {
                      const thumbnailUrl = scene.thumbnailPath
                        ? convertFileSrc(scene.thumbnailPath)
                        : null;

                      return (
                        <button
                          key={scene.index}
                          className="scene-card"
                          type="button"
                          onClick={() => onSeek(scene.startTime)}
                        >
                          <span
                            className="scene-thumb"
                            style={
                              thumbnailUrl
                                ? {
                                    backgroundImage: `linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(15, 23, 42, 0.58)), url(${thumbnailUrl})`,
                                    backgroundPosition: 'center',
                                    backgroundSize: 'cover',
                                  }
                                : {
                                    background: `linear-gradient(135deg, ${scene.thumbnailColor}, #18181b)`,
                                  }
                            }
                          />
                          <span className="scene-copy">
                            <span>Scene {scene.index}</span>
                            <span>
                              {formatSmpte(scene.startTime, file?.fps ?? 24)} -{' '}
                              {formatSmpte(scene.endTime, file?.fps ?? 24)}
                            </span>
                          </span>
                          <span className="scene-confidence">{Math.round(scene.confidence)}%</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Section>

              <Section
                title="Color Analysis"
                icon={<SlidersHorizontalIcon size={14} />}
                open={sections.palette}
                onToggle={() => onToggleSection('palette')}
              >
                <div className="palette-row">
                  {analysis.palette.map((color) => (
                    <span key={color} className="palette-chip" style={{ backgroundColor: color }}>
                      {color}
                    </span>
                  ))}
                </div>
                <div className="mood-tags">
                  {analysis.mood.map((mood) => (
                    <span key={mood} className="mood-pill">
                      {mood}
                    </span>
                  ))}
                </div>
              </Section>

              <Section
                title="Audio Analysis"
                icon={<LanguagesIcon size={14} />}
                open={sections.audio}
                onToggle={() => onToggleSection('audio')}
              >
                <div className="waveform">
                  {analysis.audioWaveform.map((value, index) => (
                    <span key={`${value}-${index}`} style={{ height: `${value}%` }} />
                  ))}
                </div>
                <div className="audio-toolbar">
                  <span className="info-pill">
                    <LanguagesIcon size={12} />
                    {analysis.language}
                  </span>
                  <div className="transcript-format-switcher">
                    {(['txt', 'srt', 'vtt'] as TranscriptExportFormat[]).map((format) => (
                      <button
                        key={format}
                        className={`format-pill ${transcriptFormat === format ? 'format-pill-active' : ''}`}
                        type="button"
                        onClick={() => onTranscriptFormatChange(format)}
                      >
                        {format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                {analysis.transcript.length === 0 ? (
                  <p className="empty-copy">No transcript was generated for this run.</p>
                ) : (
                  <div className="transcript-list">
                    {analysis.transcript.map((segment) => (
                      <button
                        key={segment.id}
                        className="transcript-line"
                        type="button"
                        onClick={() => onSeek(segment.startTime)}
                      >
                        <span>{formatSmpte(segment.startTime, file?.fps ?? 24)}</span>
                        <strong>Speaker {segment.speaker}</strong>
                        <span>{segment.text}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Section>

              <Section
                title="Custom Tags"
                icon={<ScanLineIcon size={14} />}
                open={sections.tags}
                onToggle={() => onToggleSection('tags')}
              >
                <div className="tag-list">
                  {file?.tags.map((tag) => (
                    <button key={tag} className="tag-pill" type="button" onClick={() => onRemoveTag(tag)}>
                      {tag}
                    </button>
                  ))}
                </div>
                <form
                  className="tag-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!draftTag.trim()) {
                      return;
                    }

                    onAddTag(draftTag);
                    setDraftTag('');
                  }}
                >
                  <input
                    placeholder="Add tag"
                    value={draftTag}
                    onChange={(event) => setDraftTag(event.target.value)}
                  />
                  <button className="toolbar-button toolbar-button-primary" type="submit">
                    Add
                  </button>
                </form>
              </Section>
            </>
          )}
        </>
      )}
    </aside>
  );
}
