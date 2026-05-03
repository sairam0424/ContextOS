import { useMemo, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useWorkspaceState } from './hooks/useWorkspaceState.js';
import AetherGraph from './components/AetherGraph';
import ErrorBoundary from './components/ErrorBoundary';
import HudHeader from './components/HudHeader';
import HudSidebar from './components/HudSidebar';
import HudFooter from './components/HudFooter';
import NodeInspector from './components/NodeInspector';
import GraphFilterBar from './components/GraphFilterBar';
import type { NodeData } from './types.js';

function App() {
  const state = useWorkspaceState();
  const { send } = useWebSocket({
    onMessage: state.handleMessage,
    onConnectionChange: useCallback((connected: boolean) => {
      state.setIsConnected(connected);
      if (!connected) state.setTicker(`AETHER CORE: LINK SEVERED. RECONNECTING...`);
    }, [state.setIsConnected, state.setTicker]),
  });

  // Filter graph nodes by query
  const visibleGraphData = useMemo(() => {
    const q = state.filterQuery.toLowerCase().trim();
    if (!q) return state.graphData;
    const matchedIds = new Set(state.graphData.nodes.filter(n => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)).map(n => n.id));
    // Include nodes connected to a match
    state.graphData.links.forEach((link: any) => {
      const s = typeof link.source === 'object' ? link.source.id : link.source;
      const t = typeof link.target === 'object' ? link.target.id : link.target;
      if (matchedIds.has(s)) matchedIds.add(t);
      if (matchedIds.has(t)) matchedIds.add(s);
    });
    return {
      nodes: state.graphData.nodes.filter(n => matchedIds.has(n.id)),
      links: state.graphData.links.filter((l: any) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return matchedIds.has(s) && matchedIds.has(t);
      }),
    };
  }, [state.graphData, state.filterQuery]);

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    state.setTicker(`SYSTEM CLASSIFIER: PATH COPIED [${path}]`, 3000);
  };

  const handlePulseNode = (id: string) => {
    send({ type: 'action', action: 'pulse_node', payload: { id } });
    state.setTicker(`AETHER ACTION: TRIGGERING FORCE PULSE [${id}]`);
  };

  const handleAcquireLock = (id: string) => {
    send({ type: 'action', action: 'acquire_lock', payload: { path: id, agentId: 'dashboard' } });
    state.setTicker(`NEXUS: ACQUIRING LOCK [${id}]`);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <div className="absolute inset-0 z-0">
        <ErrorBoundary>
          <AetherGraph
            onNodeClick={(node: NodeData | null) => state.setSelectedNode(node)}
            graphData={visibleGraphData}
            focusedNodeId={state.focusedNodeId}
          />
        </ErrorBoundary>
      </div>

      <GraphFilterBar value={state.filterQuery} onChange={state.setFilterQuery} />

      <div className="absolute inset-0 pointer-events-none z-10 grid grid-areas-hud gap-5 p-6 box-border">
        <HudHeader isConnected={state.isConnected} pulse={state.pulse} />
        <HudSidebar pulse={state.pulse} />
        <NodeInspector
          selectedNode={state.selectedNode}
          onClose={() => state.setSelectedNode(null)}
          onCopyPath={handleCopyPath}
          onPulseNode={handlePulseNode}
          onAcquireLock={handleAcquireLock}
        />
        <HudFooter ticker={state.ticker} />
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
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,240,255,0.3); border-radius: 2px; }
      `}</style>
    </div>
  );
}

export default App;
