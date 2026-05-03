import { Zap, Radio, BrainCircuit } from 'lucide-react';
import type { PulseData } from '../types.js';

interface Props {
  pulse: PulseData | null;
}

const HudSidebar: React.FC<Props> = ({ pulse }) => (
  <aside className="grid-in-sidebar flex flex-col gap-5">
    <div className="glass p-5 pointer-events-auto">
      <div className="font-display text-[11px] uppercase text-primary tracking-[2px] mb-4 flex items-center gap-2">
        <Zap size={14} /> Trending Context
      </div>
      <div className="flex flex-wrap gap-2">
        {pulse?.topTags.map(tag => (
          <span key={tag} className="px-3 py-1 bg-secondary/10 border border-secondary/30 rounded-full text-[11px] text-[#d8b4ff] hover:bg-secondary/30 transition-colors cursor-pointer">
            #{tag}
          </span>
        ))}
      </div>
    </div>

    <div className="glass p-5 pointer-events-auto flex-1 overflow-hidden flex flex-col">
      <div className="font-display text-[11px] uppercase text-primary tracking-[2px] mb-4 flex items-center gap-2">
        <Radio size={14} /> Live Activity
      </div>
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {pulse?.recentChanges.map((change, i) => (
          <div key={i} className="glass bg-black/20 p-3 mb-3 text-[11px] shadow-none border-none">
            <div className="text-primary text-[9px] mb-1 opacity-60 uppercase font-display">Recent Sync</div>
            <div className="truncate">{change}</div>
          </div>
        ))}
      </div>
    </div>

    <div className="glass p-5 pointer-events-auto">
      <div className="font-display text-[11px] uppercase text-primary tracking-[2px] mb-4 flex items-center gap-2">
        <BrainCircuit size={14} /> Intelligence Backbone
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-2 bg-white/5 rounded">
          <div className="text-[10px] text-text-dim uppercase mb-1">Queue</div>
          <div className="text-sm font-bold text-white">{pulse?.intelligenceStatus.pending ?? 0}</div>
        </div>
        <div className="text-center p-2 bg-primary/10 rounded ring-1 ring-primary/30">
          <div className="text-[10px] text-primary uppercase mb-1">Active</div>
          <div className="text-sm font-bold text-primary animate-pulse">{pulse?.intelligenceStatus.processing ?? 0}</div>
        </div>
        <div className="text-center p-2 bg-secondary/10 rounded">
          <div className="text-[10px] text-secondary uppercase mb-1">Ready</div>
          <div className="text-sm font-bold text-secondary">{pulse?.intelligenceStatus.ready ?? 0}</div>
        </div>
      </div>
      <div className="mt-4 h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-1000"
          style={{
            width: `${pulse ? (pulse.intelligenceStatus.ready / Math.max(pulse.intelligenceStatus.ready + pulse.intelligenceStatus.pending + pulse.intelligenceStatus.processing, 1)) * 100 : 0}%`
          }}
        />
      </div>
    </div>
  </aside>
);

export default HudSidebar;
