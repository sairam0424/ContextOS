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
  | { type: 'pulse.updated'; healthScore: number }
  | { type: 'agent.registered'; agentId: string; name: string }
  | { type: 'agent.deregistered'; agentId: string; reason: string }
  | { type: 'agent.quarantined'; agentId: string; reason: string }
  | { type: 'agent.reactivated'; agentId: string; reason: string }
  | { type: 'message.sent'; from: string; to: string; intent: string }
  | { type: 'task.assigned'; taskId: string; agentId: string }
  | { type: 'task.completed'; taskId: string }
  | { type: 'task.failed'; taskId: string };

export type EventType = WorkspaceEvent['type'];

export type EventPayload<T extends EventType> = Extract<WorkspaceEvent, { type: T }>;

export type EventHandler<T extends EventType> = (event: EventPayload<T>) => void;
