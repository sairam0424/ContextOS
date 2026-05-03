import { useState, useCallback, useRef, useEffect } from 'react';
import type { PulseData, NodeData, GraphData } from '../types.js';

export interface WorkspaceState {
  pulse: PulseData | null;
  graphData: GraphData;
  selectedNode: NodeData | null;
  focusedNodeId: string | null;
  ticker: string;
  isConnected: boolean;
  filterQuery: string;
}

export interface WorkspaceActions {
  setSelectedNode: (node: NodeData | null) => void;
  setFilterQuery: (q: string) => void;
  setTicker: (msg: string, resetAfterMs?: number) => void;
  setIsConnected: (v: boolean) => void;
  handleMessage: (message: any) => void;
}

export function useWorkspaceState(): WorkspaceState & WorkspaceActions {
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [ticker, setTickerState] = useState("AETHER CORE: OFFLINE. STANDBY.");
  const [isConnected, setIsConnected] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const graphDataRef = useRef(graphData);
  const tickerResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    graphDataRef.current = graphData;
  }, [graphData]);

  const setTicker = useCallback((msg: string, resetAfterMs?: number) => {
    setTickerState(msg);
    if (tickerResetTimer.current) clearTimeout(tickerResetTimer.current);
    if (resetAfterMs) {
      tickerResetTimer.current = setTimeout(() => setTickerState("IDLE MONITORS ACTIVE... STANDBY."), resetAfterMs);
    }
  }, []);

  const handleMessage = useCallback((message: any) => {
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
      if (node) setTicker(`AGENT FOCUS: INVESTIGATING [${node.label}]`);
    }

    if (message.type === 'lock_update') {
      const { path, locked, agentId } = message;
      setGraphData(prev => ({
        ...prev,
        nodes: prev.nodes.map(n =>
          n.id === path
            ? { ...n, metadata: { ...n.metadata, lock: locked ? { agent_id: agentId } : undefined } }
            : n
        )
      }));
    }

    if (message.type === 'connected') {
      setIsConnected(true);
      setTicker("AETHER CORE: LINK ESTABLISHED. MONITORING PULSE.");
    }
  }, [setTicker]);

  return {
    pulse, graphData, selectedNode, focusedNodeId, ticker, isConnected, filterQuery,
    setSelectedNode, setFilterQuery, setTicker, setIsConnected, handleMessage,
  };
}
