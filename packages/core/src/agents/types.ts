export interface AgentRecord {
  id: string;
  name: string;
  capabilities: string[];
  status: 'active' | 'idle' | 'quarantined';
  transport: 'stdio' | 'http';
  lastHeartbeat: number;
  registeredAt: number;
  metadata: Record<string, unknown>;
}

export interface RegisterOpts {
  name: string;
  capabilities: string[];
  transport?: 'stdio' | 'http';
  metadata?: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  correlationId?: string;
  from: string;
  to: string;
  intent: string;
  payload: unknown;
  timestamp: number;
  deliveredAt?: number;
  ttl?: number;
}

export interface SendMessageOpts {
  from: string;
  to: string;
  intent: string;
  payload?: unknown;
  correlationId?: string;
  ttl?: number;
}

export type AgentStatus = AgentRecord['status'];
