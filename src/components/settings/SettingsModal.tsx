import { X } from 'lucide-react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({
  open,
  onClose,
}: SettingsModalProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <p className="panel-kicker">Settings</p>
            <h2 id="settings-title" className="panel-title">
              Workstation Preferences
            </h2>
          </div>
          <button className="toolbar-icon-button" type="button" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="settings-grid">
          <article className="settings-card">
            <h3>General</h3>
            <p>Default export folder, launch behavior, hardware acceleration toggle.</p>
          </article>
          <article className="settings-card">
            <h3>Transcription</h3>
            <p>Whisper model size, language preference, punctuation, subtitle export defaults.</p>
          </article>
          <article className="settings-card">
            <h3>Scene Detection</h3>
            <p>Sensitivity, minimum shot length, and blackframe thresholds.</p>
          </article>
          <article className="settings-card">
            <h3>Presets</h3>
            <p>Manage codec, bitrate, resolution, and timeline-safe export templates.</p>
          </article>
        </div>
      </section>
    </div>
  );
}
