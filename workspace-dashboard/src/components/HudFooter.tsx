import { Clock } from 'lucide-react';

interface Props {
  ticker: string;
  onTimelineToggle: () => void;
  showTimeline: boolean;
}

const HudFooter: React.FC<Props> = ({ ticker, onTimelineToggle, showTimeline }) => (
  <footer className="grid-in-footer flex justify-between items-center pointer-events-none">
    <div className="glass py-2 px-4 pointer-events-auto flex items-center gap-4">
      <div className="w-2 h-2 rounded-full bg-primary shadow-glow animate-pulse" />
      <div className="font-display text-[10px] text-primary tracking-[1px] w-[300px] truncate">
        {ticker}
      </div>
      <div className="font-display text-xs">
        {new Date().toLocaleTimeString()}
      </div>
    </div>
    <div className="glass py-2 px-4 pointer-events-auto flex items-center gap-4 font-display text-[10px] tracking-[1px]">
      <button
        onClick={onTimelineToggle}
        title="Toggle activity timeline"
        className={`flex items-center gap-1 transition-colors ${showTimeline ? 'text-primary' : 'text-white/40 hover:text-white/70'}`}
      >
        <Clock size={12} />
        <span className="uppercase text-[9px]">History</span>
      </button>
      <span>DECK: <span className="text-primary">V2.0.0-NEXUS</span></span>
    </div>
  </footer>
);

export default HudFooter;
