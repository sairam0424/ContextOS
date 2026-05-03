import { useState, useEffect } from 'react';
import { X, Clock, FileText, Eye, Edit } from 'lucide-react';

interface HistoryEntry {
  id: number;
  path: string;
  action: 'read' | 'write' | 'focus';
  timestamp: number;
}

interface Props {
  onClose: () => void;
}

const actionIcon = (action: string) => {
  if (action === 'write') return <Edit size={10} className="text-yellow-400" />;
  if (action === 'focus') return <Eye size={10} className="text-primary" />;
  return <FileText size={10} className="text-white/40" />;
};

const relativeTime = (ts: number): string => {
  const diffMs = Date.now() - ts;
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
};

const TimelinePanel: React.FC<Props> = ({ onClose }) => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/history?limit=50', { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => { setEntries(data); setLoading(false); })
      .catch(err => {
        if (err.name !== 'AbortError') { setError(err.message); setLoading(false); }
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 glass w-[540px] max-h-[400px] flex flex-col pointer-events-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2 font-display text-[11px] uppercase text-primary tracking-[2px]">
          <Clock size={13} /> Activity Timeline
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 custom-scrollbar">
        {loading && (
          <div className="flex items-center justify-center py-10 text-white/30 text-[11px]">
            Loading history...
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center py-10 text-red-400 text-[11px]">
            Failed to load: {error}
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="flex items-center justify-center py-10 text-white/30 text-[11px]">
            No activity recorded yet.
          </div>
        )}
        {!loading && !error && entries.map((entry, i) => (
          <div key={entry.id} className={`flex items-start gap-3 px-4 py-2 text-[11px] ${i !== entries.length - 1 ? 'border-b border-white/5' : ''}`}>
            {/* Timeline line */}
            <div className="flex flex-col items-center flex-shrink-0 mt-1">
              <div className="w-1 h-1 rounded-full bg-primary/60" />
              {i < entries.length - 1 && <div className="w-px flex-1 bg-white/10 mt-1" style={{ minHeight: 16 }} />}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
              {actionIcon(entry.action)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white/80 truncate font-mono text-[10px]">{entry.path}</div>
              <div className="text-white/30 text-[9px] mt-0.5 capitalize">{entry.action}</div>
            </div>
            <div className="text-white/30 text-[9px] flex-shrink-0 mt-0.5">{relativeTime(entry.timestamp)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TimelinePanel;
