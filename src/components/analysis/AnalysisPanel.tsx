import {
  ChevronDown,
  ChevronRight,
  Languages,
  ScanLine,
  SlidersHorizontal,
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
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
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
}: AnalysisPanelProps): JSX.Element {
  const [draftTag, setDraftTag] = useState('');
  const analysis = file?.analysis;

  return (
    <aside className={`panel panel-analysis ${collapsed ? 'panel-collapsed' : ''}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Analysis</p>
          <h2 className="panel-title">Clip Intelligence</h2>
        </div>
        <div className="panel-header-actions">
          <button className="toolbar-icon-button" type="button">
            <ScanLine size={14} />
          </button>
          <button className="toolbar-icon-button" type="button">
            <SlidersHorizontal size={14} />
          </button>
          <button className="toolbar-icon-button" type="button" onClick={onToggleCollapsed}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="analysis-toolbar">
            <button className="toolbar-button toolbar-button-primary" type="button">
              Process
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

          {!analysis && <p className="empty-copy">Select a file and click Analyze.</p>}

          {analysis && (
            <>
              <Section
                title="Scene Detection"
                icon={<ScanLine size={14} />}
                open={sections.scenes}
                onToggle={() => onToggleSection('scenes')}
              >
                <div className="scene-list">
                  {analysis.scenes.map((scene) => (
                    <button
                      key={scene.index}
                      className="scene-card"
                      type="button"
                      onClick={() => onSeek(scene.startTime)}
                    >
                      <span
                        className="scene-thumb"
                        style={{
                          background: `linear-gradient(135deg, ${scene.thumbnailColor}, #18181b)`,
                        }}
                      />
                      <span className="scene-copy">
                        <span>Scene {scene.index}</span>
                        <span>
                          {formatSmpte(scene.startTime, file?.fps ?? 24)} -{' '}
                          {formatSmpte(scene.endTime, file?.fps ?? 24)}
                        </span>
                      </span>
                      <span className="scene-confidence">{scene.confidence}%</span>
                    </button>
                  ))}
                </div>
              </Section>

              <Section
                title="Color Analysis"
                icon={<SlidersHorizontal size={14} />}
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
                icon={<Languages size={14} />}
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
                    <Languages size={12} />
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
              </Section>

              <Section
                title="Custom Tags"
                icon={<ScanLine size={14} />}
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
