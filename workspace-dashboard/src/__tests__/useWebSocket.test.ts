import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../hooks/useWebSocket.js';

// --- WebSocket mock ---

interface MockWebSocketInstance {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  readyState: number;
}

let mockInstances: MockWebSocketInstance[] = [];

class MockWebSocket implements MockWebSocketInstance {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => {
    this.onclose?.();
  });
  send = vi.fn();
  readyState = 0;

  constructor(_url: string) {
    mockInstances.push(this);
  }
}

beforeEach(() => {
  mockInstances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useWebSocket', () => {
  it('reports disconnected state initially (before onopen fires)', () => {
    const onMessage = vi.fn();
    const onConnectionChange = vi.fn();

    renderHook(() => useWebSocket({ onMessage, onConnectionChange }));

    // WebSocket was created but onopen has not fired yet
    expect(onConnectionChange).not.toHaveBeenCalledWith(true);
  });

  it('calls onConnectionChange(true) when WebSocket opens', () => {
    const onMessage = vi.fn();
    const onConnectionChange = vi.fn();

    renderHook(() => useWebSocket({ onMessage, onConnectionChange }));

    const ws = mockInstances[0];
    act(() => {
      ws.onopen?.();
    });

    expect(onConnectionChange).toHaveBeenCalledWith(true);
  });

  it('calls onMessage callback when a message is received', () => {
    const onMessage = vi.fn();
    const onConnectionChange = vi.fn();

    renderHook(() => useWebSocket({ onMessage, onConnectionChange }));

    const ws = mockInstances[0];
    act(() => {
      ws.onopen?.();
    });

    const payload = { type: 'sync', data: { graph: {} } };
    act(() => {
      ws.onmessage?.({ data: JSON.stringify(payload) });
    });

    expect(onMessage).toHaveBeenCalledWith(payload);
  });

  it('ignores malformed JSON messages without throwing', () => {
    const onMessage = vi.fn();
    const onConnectionChange = vi.fn();

    renderHook(() => useWebSocket({ onMessage, onConnectionChange }));

    const ws = mockInstances[0];
    act(() => {
      ws.onopen?.();
    });

    act(() => {
      ws.onmessage?.({ data: 'not valid json {{{' });
    });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('reconnects with exponential backoff on disconnect', () => {
    const onMessage = vi.fn();
    const onConnectionChange = vi.fn();

    renderHook(() => useWebSocket({ onMessage, onConnectionChange }));

    const ws1 = mockInstances[0];

    // Simulate connection then disconnect
    act(() => {
      ws1.onopen?.();
    });
    act(() => {
      ws1.onclose?.();
    });

    expect(onConnectionChange).toHaveBeenCalledWith(false);

    // After 1000ms (initial delay), should reconnect
    expect(mockInstances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockInstances).toHaveLength(2);

    // Disconnect again — delay should be 2000ms
    const ws2 = mockInstances[1];
    act(() => {
      ws2.onclose?.();
    });

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(mockInstances).toHaveLength(2); // not yet

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mockInstances).toHaveLength(3); // now reconnected
  });

  it('caps reconnect delay at 30 seconds', () => {
    const onMessage = vi.fn();
    const onConnectionChange = vi.fn();

    renderHook(() => useWebSocket({ onMessage, onConnectionChange }));

    // Simulate many disconnects to drive backoff up
    for (let i = 0; i < 10; i++) {
      const ws = mockInstances[mockInstances.length - 1];
      act(() => {
        ws.onclose?.();
      });
      act(() => {
        vi.advanceTimersByTime(30000);
      });
    }

    // The delay should have been capped at 30000ms
    const ws = mockInstances[mockInstances.length - 1];
    act(() => {
      ws.onclose?.();
    });

    // Should reconnect within 30s, not longer
    const countBefore = mockInstances.length;
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(mockInstances.length).toBe(countBefore + 1);
  });

  it('cleans up WebSocket on unmount', () => {
    const onMessage = vi.fn();
    const onConnectionChange = vi.fn();

    const { unmount } = renderHook(() => useWebSocket({ onMessage, onConnectionChange }));

    const ws = mockInstances[0];
    act(() => {
      ws.onopen?.();
    });

    unmount();

    expect(ws.close).toHaveBeenCalled();
  });

  it('does not reconnect after unmount', () => {
    const onMessage = vi.fn();
    const onConnectionChange = vi.fn();

    const { unmount } = renderHook(() => useWebSocket({ onMessage, onConnectionChange }));

    const ws = mockInstances[0];
    act(() => {
      ws.onopen?.();
    });

    unmount();

    // Advance timers — no new WebSocket should be created
    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(mockInstances).toHaveLength(1);
  });
});
