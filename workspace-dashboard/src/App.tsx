import { useState, useEffect, useRef } from 'react';
import { BrainCircuit, Zap, Radio, Info, X, Copy, MousePointer2, Wifi, WifiOff } from 'lucide-react';
import AetherGraph from './components/AetherGraph';
import ErrorBoundary from './components/ErrorBoundary';
import type { PulseData, NodeData, GraphData } from './types.ts';

function App() {
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [ticker, setTicker] = useState("AETHER CORE: OFFLINE. STANDBY.");
  const [isConnected, setIsConnected] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const graphDataRef = useRef(graphData);
  const reconnectDelay = useRef(1000);

  // Keep ref in sync to avoid stale closures in WebSocket handler
  useEffect(() => {
    graphDataRef.current = graphData;
  }, [graphData]);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function doConnect() {
      if (cancelled) return;
      const ws = new WebSocket(`ws://${window.location.host}`);

      ws.onopen = () => {
        setIsConnected(true);
        setTicker("AETHER CORE: LINK ESTABLISHED. MONITORING PULSE.");
        reconnectDelay.current = 1000;
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);

        if (message.type === 'init' || message.type === 'sync') {
          setPulse(message.data.pulse);
          setGraphData(message.data.graph);

          if (message.event && message.type === 'sync') {
            setTicker(`SIGNAL DETECTED: [${message.event.type.toUpperCase()}] ${message.event.path}`);
          }
        }

        if (message.type === 'agent_focus') {
          setFocusedNodeId(message.id);
          const node = graphDataRef.current.nodes.find(n => n.id === message.id);
          if (node) {
            setTicker(`AGENT FOCUS: INVESTIGATING [${node.label}]`);
          }
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        socketRef.current = null;
        if (!cancelled) {
          const delay = reconnectDelay.current;
          setTicker(`AETHER CORE: LINK SEVERED. RECONNECTING IN ${delay / 1000}s...`);
          reconnectDelay.current = Math.min(delay * 2, 30000);
          reconnectTimer = setTimeout(doConnect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      socketRef.current = ws;
    }

    doConnect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
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
        <ErrorBoundary>
          <AetherGraph
            onNodeClick={setSelectedNode}
            graphData={graphData}
            focusedNodeId={focusedNodeId}
          />
        </ErrorBoundary>
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

          {/* Intelligence Backbone Status */}
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
                    {selectedNode.metadata?.excerpt && (
                      <p className="text-secondary/70 leading-relaxed italic mb-4">
                        "{selectedNode.metadata.excerpt}"
                      </p>
                    )}

                    {selectedNode.type === 'symbol' && (
                      <div className="space-y-4">
                        <div className="p-3 bg-white/5 rounded border border-white/10">
                          <div className="text-[10px] uppercase tracking-wider text-secondary/50 mb-1">Signature</div>
                          <code className="text-xs text-secondary/90 break-all">{selectedNode.metadata?.signature}</code>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-secondary/60">
                          <span className="px-2 py-0.5 bg-primary/20 text-primary rounded ring-1 ring-primary/30 uppercase text-[9px]">
                            {selectedNode.metadata?.symbolType}
                          </span>
                          <span>L{selectedNode.metadata?.line} in {selectedNode.metadata?.path?.split('/').pop()}</span>
                        </div>
                      </div>
                    )}
                  </div>
               </div>

                <div>
                  <div className="font-display text-[9px] uppercase text-primary tracking-[2px] opacity-60 mb-3">Entity Classification</div>
                  <div className="flex gap-2">
                    <span className="px-3 py-1 border border-primary text-primary text-[10px] rounded-full">Type: {selectedNode.type}</span>
                    <span className={`px-3 py-1 border text-[10px] rounded-full ${
                      selectedNode.metadata?.intelligenceStatus === 'ready'
                        ? 'border-secondary text-secondary'
                        : selectedNode.metadata?.intelligenceStatus === 'processing'
                        ? 'border-primary text-primary animate-pulse'
                        : 'border-white/20 text-white/50'
                    }`}>
                      Backbone: {selectedNode.metadata?.intelligenceStatus || 'pending'}
                    </span>
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-2 mt-2">
                 <button
                  onClick={() => copyPath(selectedNode.id)}
                  className="glass p-3 text-[10px] uppercase flex items-center justify-center gap-2 hover:bg-white/5 transition-colors border-none"
                 >
                   <Copy size={12} /> Copy
                 </button>
                 <button
                  onClick={() => {
                    socketRef.current?.send(JSON.stringify({ type: 'action', action: 'pulse_node', payload: { id: selectedNode.id } }));
                    setTicker(`AETHER ACTION: TRIGGERING FORCE PULSE [${selectedNode.label}]`);
                  }}
                  className="glass p-3 text-[10px] uppercase flex items-center justify-center gap-2 hover:bg-primary/10 transition-colors border-none text-primary"
                 >
                   <Zap size={12} /> Pulse
                 </button>
               </div>

               {selectedNode.type === 'document' && (
                 <div className="mt-4">
                    <div className="font-display text-[9px] uppercase text-primary tracking-[2px] opacity-60 mb-3">Nexus Actions</div>
                    <button
                      className="w-full text-[10px] p-4 glass bg-primary/5 hover:bg-primary/10 text-primary border-primary/20 flex items-center justify-between group transition-all"
                      onClick={() => {
                        setTicker("SYSTEM: SELECT TARGET NODE TO BRIDGE...");
                      }}
                    >
                      <span className="font-display tracking-[1px]">ACQUIRE CONCURRENCY LOCK</span>
                      <BrainCircuit size={14} className="group-hover:rotate-12 transition-transform" />
                    </button>
                 </div>
               )}
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
            DECK: <span className="text-primary">V1.12.0-NEXUS</span>
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
