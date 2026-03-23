import { Check, Pause, Play, Trash2, X } from 'lucide-react';
import { ProgressBar } from '../ui/ProgressBar';
import type { ProjectFile, QueueItem } from '../../types/models';

interface QueueBarProps {
  queue: QueueItem[];
  files: ProjectFile[];
  onPause: (queueId: string) => void;
  onCancel: (queueId: string) => void;
  onClearCompleted: () => void;
}

function resolveFileName(files: ProjectFile[], fileId: string): string {
  return files.find((file) => file.id === fileId)?.name ?? fileId;
}

export function QueueBar({
  queue,
  files,
  onPause,
  onCancel,
  onClearCompleted,
}: QueueBarProps): JSX.Element {
  return (
    <section className="queue-bar">
      <div className="queue-bar-header">
        <div>
          <p className="panel-kicker">Queue</p>
          <h2 className="panel-title">Batch Processing</h2>
        </div>
        <button className="toolbar-button" type="button" onClick={onClearCompleted}>
          Clear Completed
        </button>
      </div>

      <div className="queue-list">
        {queue.map((item) => (
          <article key={item.id} className={`queue-item queue-item-${item.state}`}>
            <div className="queue-item-main">
              <div>
                <strong>{resolveFileName(files, item.fileId)}</strong>
                <p>
                  {item.preset.name} • ETA {item.eta}
                </p>
              </div>
              <div className="queue-controls">
                <button className="toolbar-icon-button" type="button" onClick={() => onPause(item.id)}>
                  {item.state === 'paused' ? <Play size={14} /> : <Pause size={14} />}
                </button>
                <button className="toolbar-icon-button" type="button" onClick={() => onCancel(item.id)}>
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="queue-item-progress">
              <ProgressBar value={item.progress} tone={item.state === 'done' ? 'success' : 'accent'} />
              <span className="queue-state">
                {item.state === 'done' ? <Check size={14} /> : null}
                {item.state}
              </span>
            </div>
          </article>
        ))}
        {queue.length === 0 && (
          <div className="queue-empty">
            <Trash2 size={16} />
            <span>No queued exports yet.</span>
          </div>
        )}
      </div>
    </section>
  );
}
