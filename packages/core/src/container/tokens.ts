export const TOKENS = {
  Database: Symbol.for('ctx:Database'),
  EventBus: Symbol.for('ctx:EventBus'),
  Intelligence: Symbol.for('ctx:Intelligence'),
  IntelligenceQueue: Symbol.for('ctx:IntelligenceQueue'),
  KnowledgeGraph: Symbol.for('ctx:KnowledgeGraph'),
  Embedding: Symbol.for('ctx:Embedding'),
  Sampling: Symbol.for('ctx:Sampling'),
  Validation: Symbol.for('ctx:Validation'),
  Watch: Symbol.for('ctx:Watch'),
  Repair: Symbol.for('ctx:Repair'),
  Locking: Symbol.for('ctx:Locking'),
  Mission: Symbol.for('ctx:Mission'),
  Federation: Symbol.for('ctx:Federation'),
  Capability: Symbol.for('ctx:Capability'),
  WorkspaceConfig: Symbol.for('ctx:WorkspaceConfig'),
  Workspace: Symbol.for('ctx:Workspace'),
} as const;

export type ServiceToken = typeof TOKENS[keyof typeof TOKENS];
