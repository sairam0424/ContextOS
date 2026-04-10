import { useState, useEffect } from 'react';
import { BrainCircuit, Zap, Radio, Info, X, Copy, MousePointer2 } from 'lucide-react';
import AetherGraph from './components/AetherGraph';
import type { PulseData, NodeData } from './types.ts';

function App() {
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [ticker, setTicker] = useState("INITIALIZING AETHER CORE... READY.");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const pulseRes = await fetch('http://localhost:3010/api/pulse');
        const data = await pulseRes.json();
        setPulse(data);
        
        if (data.recentChanges?.length > 0) {
          setTicker(`PULSE DETECTED: SYNCING [${data.recentChanges[0]}]`);
        }
      } catch (err) {
        console.error("Pulse fetch failed", err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setTicker(`SYSTEM CLASSIFIER: PATH COPIED [${path}]`);
    setTimeout(() => setTicker("IDLE MONITORS ACTIVE... STANDBY."), 3000);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      {/* 3D Graph Layer */}
      <div className="absolute inset-0 z-0">
        <AetherGraph onNodeClick={setSelectedNode} />
      </div>

      {/* UI Overlay */}
      <div className="absolute inset-0 pointer-events-none z-10 grid grid-areas-hud gap-5 p-6 box-border">
        {/* Header */}
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
            <div className="text-right">
              <div className="font-display text-[11px] uppercase text-primary tracking-[2px] opacity-80">
                Workspace Stability
              </div>
              <div className="text-lg font-bold text-primary font-display">
                {pulse?.healthScore ?? '--'}%
              </div>
            </div>
            <div className="w-10 h-10 rounded-full border-2 border-primary flex items-center justify-center text-xs text-primary animate-pulse">
              {pulse?.healthScore ?? '--'}
            </div>
          </div>
        </header>

        {/* Sidebar */}
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
        </aside>

        {/* Inspector */}
        <section className={`grid-in-inspector glass p-5 pointer-events-auto transition-transform duration-500 ${selectedNode ? 'translate-x-0' : 'translate-x-[120%]'}`}>
          <div className="flex justify-between items-start mb-5">
            <div className="font-display text-[11px] uppercase text-primary tracking-[2px] flex items-center gap-2">
              <Info size={14} /> Node Inspector
            </div>
            <button onClick={() => setSelectedNode(null)} className="text-text-dim hover:text-white transition-colors cursor-pointer">
              <X size={16} />
            </button>
          </div>

          {selectedNode ? (
            <div className="flex flex-col gap-5">
               <div>
                  <div className="text-primary font-display text-lg mb-1">{selectedNode.label}</div>
                  <div className="text-[11px] opacity-50 font-mono break-all">{selectedNode.id}</div>
               </div>

               <div className="flex flex-col gap-2">
                  <div className="font-display text-[9px] uppercase text-primary tracking-[2px] opacity-60">Intelligence Metadata</div>
                  <div className="glass bg-black/20 p-3 text-[12px] leading-relaxed">
                    {selectedNode.metadata?.excerpt || 'Scanning for latent semantic patterns...'}
                  </div>
               </div>

               <div>
                  <div className="font-display text-[9px] uppercase text-primary tracking-[2px] opacity-60 mb-3">Entity Classification</div>
                  <div className="flex gap-2">
                    <span className="px-3 py-1 border border-primary text-primary text-[10px] rounded-full">Type: {selectedNode.type}</span>
                    <span className="px-3 py-1 border border-white/20 text-white/50 text-[10px] rounded-full">Access: Federated</span>
                  </div>
               </div>

               <button 
                onClick={() => copyPath(selectedNode.id)}
                className="glass w-full p-3 text-[11px] uppercase flex items-center justify-center gap-2 hover:bg-white/5 transition-colors"
               >
                 <Copy size={12} /> Copy Path
               </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 opacity-40 italic">
              <MousePointer2 size={32} className="mb-4" />
              <p className="text-xs">Select an entity to reveal its spatial soul</p>
            </div>
          )}
        </section>

        {/* Footer */}
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

          <div className="glass py-2 px-4 pointer-events-auto font-display text-[10px] tracking-[1px]">
            DECK: <span className="text-primary">V1.7.0-AETHER-ADVANCED</span>
          </div>
        </footer>
      </div>
      
      <style>{`
        .grid-areas-hud {
          grid-template-areas: 
            "header header header"
            "sidebar content inspector"
            "footer footer footer";
          grid-template-rows: auto 1fr auto;
          grid-template-columns: 320px 1fr 320px;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.05);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 240, 255, 0.3);
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}

export default App;
