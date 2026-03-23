interface ProgressBarProps {
  value: number;
  tone?: 'accent' | 'success' | 'danger';
}

export function ProgressBar({
  value,
  tone = 'accent',
}: ProgressBarProps): JSX.Element {
  return (
    <div className="progress-bar" aria-hidden="true">
      <span
        className={`progress-fill progress-fill-${tone}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
