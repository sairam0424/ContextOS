export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';

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
  createdAt: number;
}

export interface CreateTaskOpts {
  missionId: string;
  title: string;
  description: string;
  dependencies?: string[];
  timeout?: number;
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
