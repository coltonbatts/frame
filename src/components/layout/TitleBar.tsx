import {
  Clapperboard,
  Import,
  Minus,
  Settings2,
  Square,
  X,
} from 'lucide-react';

async function controlWindow(action: 'minimize' | 'toggleMaximize' | 'close'): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) {
    return;
  }

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const appWindow = getCurrentWindow();
  await appWindow[action]();
}

interface TitleBarProps {
  onImport: () => void;
  onSettings: () => void;
  analyzeHotkeyHint: string;
}

export function TitleBar({
  onImport,
  onSettings,
  analyzeHotkeyHint,
}: TitleBarProps): JSX.Element {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <span className="titlebar-mark">
          <Clapperboard size={14} />
        </span>
        <div className="titlebar-copy">
          <span className="titlebar-name">Frame</span>
          <span className="titlebar-subtitle">Local Video Intelligence</span>
        </div>
      </div>

      <div className="titlebar-drag-region" aria-hidden="true" data-tauri-drag-region />

      <div className="titlebar-actions">
        <span className="info-pill info-pill-muted titlebar-hotkey" data-tauri-drag-region="no-drag">
          Analyze {analyzeHotkeyHint}
        </span>
        <button
          className="toolbar-button"
          type="button"
          onClick={onImport}
          data-tauri-drag-region="no-drag"
        >
          <Import size={14} />
          Import
        </button>
        <button
          className="toolbar-icon-button"
          type="button"
          onClick={onSettings}
          data-tauri-drag-region="no-drag"
        >
          <Settings2 size={14} />
        </button>
      </div>

      <div className="window-controls">
        <button
          className="window-control"
          type="button"
          aria-label="Minimize window"
          onClick={() => void controlWindow('minimize')}
          data-tauri-drag-region="no-drag"
        >
          <Minus size={14} />
        </button>
        <button
          className="window-control"
          type="button"
          aria-label="Toggle maximize"
          onClick={() => void controlWindow('toggleMaximize')}
          data-tauri-drag-region="no-drag"
        >
          <Square size={12} />
        </button>
        <button
          className="window-control window-control-danger"
          type="button"
          aria-label="Close window"
          onClick={() => void controlWindow('close')}
          data-tauri-drag-region="no-drag"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
