export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface TaskNode {
  id: string;
  missionId: string;
  title: string;
  description: string;
  assignedTo?: string;
  status: TaskStatus;
  dependencies: string[];
  result?: unknown;
  timeout: number;
  retries: number;
  priority: number;
  requiredCapabilities: string[];
  createdAt: number;
}

export interface CreateTaskOpts {
  missionId: string;
  title: string;
  description: string;
  dependencies?: string[];
  timeout?: number;
  priority?: number;
  requiredCapabilities?: string[];
  retryConfig?: Partial<RetryConfig>;
}

export interface MissionProgress {
  missionId: string;
  total: number;
  pending: number;
  assigned: number;
  inProgress: number;
  completed: number;
  failed: number;
}
