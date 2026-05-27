import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspaceState } from '../hooks/useWorkspaceState.js';
import type { GraphData, PulseData } from '../types.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWorkspaceState', () => {
  describe('initial state', () => {
    it('has empty graph data on init', () => {
      const { result } = renderHook(() => useWorkspaceState());

      expect(result.current.graphData).toEqual({ nodes: [], links: [] });
    });

    it('has null pulse on init', () => {
      const { result } = renderHook(() => useWorkspaceState());

      expect(result.current.pulse).toBeNull();
    });

    it('has null selectedNode on init', () => {
      const { result } = renderHook(() => useWorkspaceState());

      expect(result.current.selectedNode).toBeNull();
    });

    it('has null focusedNodeId on init', () => {
      const { result } = renderHook(() => useWorkspaceState());

      expect(result.current.focusedNodeId).toBeNull();
    });

    it('has isConnected false on init', () => {
      const { result } = renderHook(() => useWorkspaceState());

      expect(result.current.isConnected).toBe(false);
    });

    it('has empty filterQuery on init', () => {
      const { result } = renderHook(() => useWorkspaceState());

      expect(result.current.filterQuery).toBe('');
    });
  });

  describe('handleMessage — type: init', () => {
    it('populates pulse and graph data', () => {
      const { result } = renderHook(() => useWorkspaceState());

      const pulse: PulseData = {
        healthScore: 92,
        totalNodes: 5,
        topTags: ['react', 'typescript'],
        recentChanges: ['src/index.ts'],
        intelligenceStatus: { pending: 0, processing: 1, ready: 4 },
      };

      const graph: GraphData = {
        nodes: [
          { id: 'src/index.ts', label: 'index.ts', type: 'file' },
          { id: 'react', label: 'react', type: 'tag' },
        ],
        links: [
          { source: 'src/index.ts', target: 'react', type: 'tag', weight: 1 },
        ],
      };

      act(() => {
        result.current.handleMessage({
          type: 'init',
          data: { pulse, graph },
        });
      });

      expect(result.current.pulse).toEqual(pulse);
      expect(result.current.graphData).toEqual(graph);
    });
  });

  describe('handleMessage — type: sync', () => {
    it('updates graph data on sync message', () => {
      const { result } = renderHook(() => useWorkspaceState());

      const pulse: PulseData = {
        healthScore: 88,
        totalNodes: 3,
        topTags: ['hooks'],
        recentChanges: ['src/hooks/useWebSocket.ts'],
        intelligenceStatus: { pending: 1, processing: 0, ready: 2 },
      };

      const graph: GraphData = {
        nodes: [
          { id: 'src/hooks/useWebSocket.ts', label: 'useWebSocket.ts', type: 'file' },
        ],
        links: [],
      };

      act(() => {
        result.current.handleMessage({
          type: 'sync',
          data: { pulse, graph },
          event: { type: 'change', path: 'src/hooks/useWebSocket.ts' },
        });
      });

      expect(result.current.pulse).toEqual(pulse);
      expect(result.current.graphData).toEqual(graph);
    });

    it('updates ticker with event info on sync', () => {
      const { result } = renderHook(() => useWorkspaceState());

      act(() => {
        result.current.handleMessage({
          type: 'sync',
          data: { pulse: null, graph: { nodes: [], links: [] } },
          event: { type: 'change', path: 'src/App.tsx' },
        });
      });

      expect(result.current.ticker).toContain('SIGNAL DETECTED');
      expect(result.current.ticker).toContain('CHANGE');
      expect(result.current.ticker).toContain('src/App.tsx');
    });
  });

  describe('handleMessage — type: agent_focus', () => {
    it('sets focusedNodeId from message', () => {
      const { result } = renderHook(() => useWorkspaceState());

      // First populate graph so the node exists
      act(() => {
        result.current.handleMessage({
          type: 'init',
          data: {
            pulse: null,
            graph: {
              nodes: [{ id: 'node-42', label: 'App.tsx', type: 'file' }],
              links: [],
            },
          },
        });
      });

      act(() => {
        result.current.handleMessage({
          type: 'agent_focus',
          id: 'node-42',
        });
      });

      expect(result.current.focusedNodeId).toBe('node-42');
    });

    it('updates ticker with focused node label', () => {
      const { result } = renderHook(() => useWorkspaceState());

      act(() => {
        result.current.handleMessage({
          type: 'init',
          data: {
            pulse: null,
            graph: {
              nodes: [{ id: 'node-x', label: 'Dashboard.tsx', type: 'file' }],
              links: [],
            },
          },
        });
      });

      act(() => {
        result.current.handleMessage({
          type: 'agent_focus',
          id: 'node-x',
        });
      });

      expect(result.current.ticker).toContain('AGENT FOCUS');
      expect(result.current.ticker).toContain('Dashboard.tsx');
    });
  });

  describe('handleMessage — type: lock_update', () => {
    it('sets lock on node when locked is true', () => {
      const { result } = renderHook(() => useWorkspaceState());

      act(() => {
        result.current.handleMessage({
          type: 'init',
          data: {
            pulse: null,
            graph: {
              nodes: [{ id: 'src/main.ts', label: 'main.ts', type: 'file', metadata: {} }],
              links: [],
            },
          },
        });
      });

      act(() => {
        result.current.handleMessage({
          type: 'lock_update',
          path: 'src/main.ts',
          locked: true,
          agentId: 'agent-007',
        });
      });

      const node = result.current.graphData.nodes.find(n => n.id === 'src/main.ts');
      expect(node?.metadata?.lock).toEqual({ agent_id: 'agent-007' });
    });

    it('removes lock on node when locked is false', () => {
      const { result } = renderHook(() => useWorkspaceState());

      act(() => {
        result.current.handleMessage({
          type: 'init',
          data: {
            pulse: null,
            graph: {
              nodes: [{
                id: 'src/main.ts',
                label: 'main.ts',
                type: 'file',
                metadata: { lock: { agent_id: 'agent-007' } },
              }],
              links: [],
            },
          },
        });
      });

      act(() => {
        result.current.handleMessage({
          type: 'lock_update',
          path: 'src/main.ts',
          locked: false,
          agentId: 'agent-007',
        });
      });

      const node = result.current.graphData.nodes.find(n => n.id === 'src/main.ts');
      expect(node?.metadata?.lock).toBeUndefined();
    });

    it('does not affect other nodes', () => {
      const { result } = renderHook(() => useWorkspaceState());

      act(() => {
        result.current.handleMessage({
          type: 'init',
          data: {
            pulse: null,
            graph: {
              nodes: [
                { id: 'src/a.ts', label: 'a.ts', type: 'file', metadata: {} },
                { id: 'src/b.ts', label: 'b.ts', type: 'file', metadata: {} },
              ],
              links: [],
            },
          },
        });
      });

      act(() => {
        result.current.handleMessage({
          type: 'lock_update',
          path: 'src/a.ts',
          locked: true,
          agentId: 'agent-1',
        });
      });

      const nodeB = result.current.graphData.nodes.find(n => n.id === 'src/b.ts');
      expect(nodeB?.metadata?.lock).toBeUndefined();
    });
  });

  describe('selectedNode', () => {
    it('updates on node selection via setSelectedNode', () => {
      const { result } = renderHook(() => useWorkspaceState());

      const node = { id: 'test-node', label: 'Test', type: 'file' as const };

      act(() => {
        result.current.setSelectedNode(node);
      });

      expect(result.current.selectedNode).toEqual(node);
    });

    it('clears selectedNode when set to null', () => {
      const { result } = renderHook(() => useWorkspaceState());

      const node = { id: 'test-node', label: 'Test', type: 'file' as const };

      act(() => {
        result.current.setSelectedNode(node);
      });

      act(() => {
        result.current.setSelectedNode(null);
      });

      expect(result.current.selectedNode).toBeNull();
    });
  });

  describe('setTicker', () => {
    it('resets ticker after specified delay', () => {
      const { result } = renderHook(() => useWorkspaceState());

      act(() => {
        result.current.setTicker('TEMPORARY MESSAGE', 3000);
      });

      expect(result.current.ticker).toBe('TEMPORARY MESSAGE');

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.ticker).toBe('IDLE MONITORS ACTIVE... STANDBY.');
    });
  });
});
