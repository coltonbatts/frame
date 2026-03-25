import {
  ChevronDown,
  ChevronRight,
  FolderClosed,
  Film,
  Plus,
  Trash2,
} from 'lucide-react';
import { formatBytes, formatDuration, formatResolution } from '../../lib/format';
import type { ProjectFile, ProjectFolder } from '../../types/models';
import { ProgressBar } from '../ui/ProgressBar';

const stateTone: Record<ProjectFile['state'], 'accent' | 'success' | 'danger'> = {
  idle: 'accent',
  analyzing: 'accent',
  queued: 'accent',
  processing: 'accent',
  done: 'success',
  error: 'danger',
};

interface ProjectBinProps {
  files: ProjectFile[];
  selectedFileId: string | null;
  collapsed: boolean;
  onSelect: (fileId: string) => void;
  onImport: () => void;
  onRemove: () => void;
  onQueue: () => void | Promise<void>;
  onToggleCollapsed: () => void;
}

function FileGroup({
  title,
  files,
  selectedFileId,
  collapsed,
  onSelect,
}: {
  title: ProjectFolder;
  files: ProjectFile[];
  selectedFileId: string | null;
  collapsed: boolean;
  onSelect: (fileId: string) => void;
}): JSX.Element {
  const label = title === 'raw' ? 'Raw' : 'Export';

  const getSummary = (file: ProjectFile): string => {
    const parts: string[] = [];

    if (file.width && file.height) {
      parts.push(formatResolution(file.width, file.height));
    }

    if (file.duration > 0) {
      parts.push(formatDuration(file.duration));
    }

    if (parts.length === 0) {
      parts.push('Metadata pending');
    }

    return parts.join(' • ');
  };

  return (
    <section className="bin-group">
      <button className="bin-group-toggle" type="button">
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <FolderClosed size={14} />
        <span>{label}</span>
        <span className="folder-count">{files.length}</span>
      </button>
      {!collapsed && (
        <div className="bin-file-list">
          {files.map((file) => (
            <button
              key={file.id}
              className={`file-card ${selectedFileId === file.id ? 'file-card-selected' : ''}`}
              type="button"
              onClick={() => onSelect(file.id)}
            >
              <span
                className="file-card-thumbnail"
                style={{ background: `linear-gradient(135deg, ${file.thumbnailColor}, #0f172a)` }}
              >
                <Film size={14} />
              </span>
              <span className="file-card-body">
                <span className="file-card-header">
                  <span className="file-card-name">{file.name}</span>
                  <span className={`state-dot state-${file.state}`} />
                </span>
                <span className="file-card-meta">
                  {getSummary(file)}
                </span>
                <span className="file-card-meta">
                  {file.codec} • {formatBytes(file.size)}
                </span>
                {typeof file.progress === 'number' && (
                  <span className="file-card-progress">
                    <ProgressBar value={file.progress} tone={stateTone[file.state]} />
                    <span>{Math.round(file.progress)}%</span>
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function ProjectBin({
  files,
  selectedFileId,
  collapsed,
  onSelect,
  onImport,
  onRemove,
  onQueue,
  onToggleCollapsed,
}: ProjectBinProps): JSX.Element {
  const rawFiles = files.filter((file) => file.folder === 'raw');
  const exportFiles = files.filter((file) => file.folder === 'export');

  return (
    <aside className={`panel panel-project ${collapsed ? 'panel-collapsed' : ''}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Project Bin</p>
          <h2 className="panel-title">Session Files</h2>
        </div>
        <div className="panel-header-actions">
          <button className="toolbar-icon-button" type="button" onClick={onImport}>
            <Plus size={14} />
          </button>
          <button className="toolbar-icon-button" type="button" onClick={() => void onQueue()}>
            <Film size={14} />
          </button>
          <button className="toolbar-icon-button" type="button" onClick={onRemove}>
            <Trash2 size={14} />
          </button>
          <button className="toolbar-icon-button" type="button" onClick={onToggleCollapsed}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <p className="panel-copy">
            Drag footage in, inspect metadata, and route shots into the export queue.
          </p>
          <FileGroup
            title="raw"
            files={rawFiles}
            selectedFileId={selectedFileId}
            collapsed={false}
            onSelect={onSelect}
          />
          <FileGroup
            title="export"
            files={exportFiles}
            selectedFileId={selectedFileId}
            collapsed={false}
            onSelect={onSelect}
          />
        </>
      )}
    </aside>
  );
}
