import { BrainCircuit, Wifi, WifiOff } from 'lucide-react';
import type { PulseData } from '../types.js';

interface Props {
  isConnected: boolean;
  pulse: PulseData | null;
}

const HudHeader: React.FC<Props> = ({ isConnected, pulse }) => (
  <header className="grid-in-header flex justify-between items-center">
    <div className="glass p-5 pointer-events-auto flex items-center gap-4 group">
      <BrainCircuit className="text-primary group-hover:scale-110 transition-transform" />
      <div>
        <h1 className="m-0 text-2xl font-bold tracking-[3px] uppercase text-primary drop-shadow-[0_0_15px_rgba(0,240,255,0.5)]">
          ContextOS
        </h1>
        <div className="text-[10px] text-text-dim tracking-[1px] uppercase">
          Spatial Intelligence Protocol
        </div>
      </div>
    </div>

    <div className="glass p-5 pointer-events-auto flex items-center gap-5">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isConnected ? 'bg-primary/20 text-primary' : 'bg-red-500/20 text-red-500'}`}>
        {isConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
      </div>
      <div className="text-right">
        <div className="font-display text-[11px] uppercase text-primary tracking-[2px] opacity-80">
          Workspace Stability
        </div>
        <div className="text-lg font-bold text-primary font-display">
          {pulse?.healthScore ?? '--'}%
        </div>
      </div>
    </div>
  </header>
);

export default HudHeader;
