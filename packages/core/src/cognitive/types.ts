export type MemoryType = 'observation' | 'reflection' | 'plan' | 'skill';

export interface MemoryEntry {
  readonly id: number;
  readonly agentId: string;
  readonly content: string;
  readonly type: MemoryType;
  readonly importance: number;
  readonly createdAt: number;
  readonly accessedAt: number;
  readonly accessCount: number;
  readonly parentIds: string[];
}

export interface RetrievalScore {
  readonly memoryId: number;
  readonly recency: number;
  readonly importance: number;
  readonly relevance: number;
  readonly total: number;
}

export interface MemoryStreamConfig {
  readonly recencyDecayLambda: number;
  readonly importanceWeight: number;
  readonly relevanceWeight: number;
  readonly reflectionThreshold: number;
  readonly maxRetrievalResults: number;
}

export interface Reflection {
  readonly id: number;
  readonly agentId: string;
  readonly taskId: string;
  readonly trial: number;
  readonly observation: string;
  readonly diagnosis: string;
  readonly prescription: string;
  readonly validated: boolean;
  readonly createdAt: number;
}

export interface Skill {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly code: string;
  readonly prerequisites: string[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastUsedAt: number;
  readonly createdBy: string;
  readonly version: number;
}

export interface SkillExecutionResult {
  readonly skillId: number;
  readonly success: boolean;
  readonly output: string;
  readonly error?: string;
  readonly durationMs: number;
}

export interface TreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly state: string;
  readonly action: string;
  readonly value: number;
  readonly visits: number;
  readonly children: string[];
  readonly depth: number;
  readonly isTerminal: boolean;
  readonly reflection?: string;
}

export interface LATSConfig {
  readonly maxDepth: number;
  readonly explorationConstant: number;
  readonly maxIterations: number;
  readonly branchingFactor: number;
}
