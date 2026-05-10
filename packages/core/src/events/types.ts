export type WorkspaceEvent =
  | { type: 'file.changed'; path: string; kind: 'add' | 'change' }
  | { type: 'file.deleted'; path: string }
  | { type: 'index.updated'; path: string }
  | { type: 'validation.failed'; path: string; issues: string[] }
  | { type: 'repair.started'; path: string }
  | { type: 'repair.completed'; path: string; success: boolean }
  | { type: 'embedding.ready'; path: string; docId: number }
  | { type: 'embedding.failed'; path: string; docId: number; error: string }
  | { type: 'lock.acquired'; path: string; agentId: string }
  | { type: 'lock.released'; path: string; agentId: string }
  | { type: 'agent.focused'; path: string; agentId: string }
  | { type: 'pulse.updated'; healthScore: number };

export type EventType = WorkspaceEvent['type'];

export type EventPayload<T extends EventType> = Extract<WorkspaceEvent, { type: T }>;

export type EventHandler<T extends EventType> = (event: EventPayload<T>) => void;
