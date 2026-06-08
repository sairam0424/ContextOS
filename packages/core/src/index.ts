/**
 * @context-os/core — public API barrel.
 *
 * BLESSED ENTRY POINT: new code should bootstrap the platform via the factory
 * and resolve services from the DI container:
 *
 *   import { createContextOS, TOKENS } from '@context-os/core';
 *   const ctx = createContextOS({ workspaceRoot });
 *   const service = ctx.container.resolve(TOKENS.X);
 *
 * Bare singleton imports and `createDefaultContainer` are DEPRECATED. They are
 * retained for backward compatibility and will be removed in a later v4
 * workstream (WS-F); do NOT reach for them in new code.
 *
 * Exports below are grouped by stability section. Every export in this barrel
 * is part of the public surface — adding/removing one is a breaking change.
 */

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { workspaceRoot, ALLOWED_BUCKETS } from './context.js';

// ── Services (context, indexing, intelligence, validation, persistence) ──────
export * from './context.js';
export * from './indexer.js';
export * from './services/intelligence.js';
export * from './services/validation.js';
export * from './services/workspace.js';
export * from './services/knowledge-graph.js';
export * from './services/sampling.js';
export * from './services/watch.js';
export * from './services/intelligence-queue.js';
export * from './database/index.js';
export * from './services/locking.js';
export * from './services/workspace-config.js';
export * from './services/mission.js';
export * from './services/federation.js';
export * from './validation.js';

// ── DI & lifecycle ───────────────────────────────────────────────────────────
export { ServiceContainer } from './container/index.js';
/**
 * Service-resolution tokens. Resolve via `container.resolve(TOKENS.X)`; do NOT
 * mix token-based resolution with deprecated bare singleton imports.
 */
export { TOKENS } from './container/index.js';
export type { ServiceToken, Token } from './container/index.js';
/**
 * @deprecated Use `createContextOS({ workspaceRoot })` and resolve services from
 * `ctx.container` instead. Retained for backward compatibility; scheduled for
 * removal in v4 workstream WS-F.
 */
export { createDefaultContainer } from './container/index.js';
export { createContextOS } from './factory.js';
export type { ContextOS, ContextOSConfig } from './factory.js';

// ── Events ───────────────────────────────────────────────────────────────────
export { WorkspaceEventBus, EventStore } from './events/index.js';
export type { WorkspaceEvent, EventType, EventPayload, EventHandler } from './events/index.js';

// ── Agents ───────────────────────────────────────────────────────────────────
export { AgentRegistry, MessageBus } from './agents/index.js';
export type { AgentRecord, RegisterOpts, AgentMessage, SendMessageOpts, AgentStatus } from './agents/index.js';

// ── Orchestration ────────────────────────────────────────────────────────────
export { TaskGraph, TaskScheduler, ConflictResolver, SwarmOrchestrator, NegotiationService, ConsensusService } from './orchestration/index.js';
export type { TaskNode, TaskStatus, CreateTaskOpts, MissionProgress, LockRequest, RetryConfig, TopologyMode, SwarmStatus, SwarmConfig, SwarmSession, TaskLedger, ProgressLedger, TickResult, Proposal, ProposalStatus, VoteRequest, Vote, ConsensusResult } from './orchestration/index.js';

// ── Resilience ───────────────────────────────────────────────────────────────
export { CircuitBreaker, AuditLog } from './resilience/index.js';
export type { CircuitBreakerConfig, AuditEntry } from './resilience/index.js';

// ── Metrics ──────────────────────────────────────────────────────────────────
export { MetricsCollector } from './metrics/index.js';
export type { MetricsSnapshot } from './metrics/index.js';
export { toPrometheusText } from './metrics/index.js';

// ── Cognitive ────────────────────────────────────────────────────────────────
export { MemoryStream, ReflectionEngine, SkillLibrary, LanguageAgentTreeSearch } from './cognitive/index.js';
export type { MemoryEntry, MemoryType, MemoryStreamConfig, RetrievalScore, Reflection, Skill, SkillExecutionResult, TreeNode, LATSConfig } from './cognitive/index.js';

export { TemporalGraphService } from './services/temporal-graph.js';
export type { TemporalEdge, TemporalQuery, NodeMetric, NodeEvent, Hyperedge, ImpactResult } from './services/temporal-graph.js';

// ── Governance ───────────────────────────────────────────────────────────────
export { CapabilityTokenService, TrustEngine, PolicyEngine, AnomalyDetector } from './governance/index.js';
export type { CapabilityGrant, CapabilityToken, AuthorizationResult, TrustDimension, TrustScore, TrustEvent, PolicyEffect, PolicyCondition, PolicyRule, Policy, PolicyDecision, AnomalySeverity, AnomalyType, AnomalyAlert } from './governance/index.js';

// ── Streaming ────────────────────────────────────────────────────────────────
export { EventProcessor, PredictiveHealthMonitor, KnowledgeDistiller, HierarchicalMemory } from './streaming/index.js';
export type { PatternType, PatternAction, BurstConfig, SequenceConfig, AbsenceConfig, PatternRule, PatternMatch, HealthState, HealthPrediction, ServiceSignal, DistilledKnowledge, DistillationResult, MemoryLevel, MemorySummary, CompactionConfig, CompactionResult } from './streaming/index.js';

export { GitIntelligenceService } from './services/git-intelligence.js';
export type { CoChangeEdge, FileOwnership, ChangeVelocity } from './services/git-intelligence.js';

export { MultiModalFusionService } from './services/fusion-scoring.js';
export type { FusionWeights, FusionResult, FusionCandidate } from './services/fusion-scoring.js';

export { GraphRAGService } from './services/graph-rag.js';
export type { Community, CommunitySearchResult, GraphRAGResult } from './services/graph-rag.js';

export { PredictiveFailureService } from './resilience/predictive-failure.js';
export type { PredictiveState, CUSUMResult, ProactiveAction } from './resilience/predictive-failure.js';

/**
 * Checks whether any component of targetPath (relative to rootPath) is a symlink.
 * Walks from rootPath downward through each segment of the target.
 */
function containsSymlink(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;

  const segments = relative.split(path.sep);
  let current = rootPath;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return true;
    } catch {
      // Path segment does not exist yet; stop checking
      break;
    }
  }

  return false;
}

// ── Workspace utilities (path-safety guards) ─────────────────────────────────
// SECURITY: validatePath() and isReadOnly() MUST be called before any file
// access. validatePath() rejects paths outside the workspace root, outside an
// allowed bucket, or routed through symlinks; isReadOnly() blocks writes to
// read-only buckets. Skipping these guards before reading/writing is a security
// defect.

/**
 * Validates that a path is within the workspace root and inside an allowed bucket.
 *
 * MUST be called before any file access — it is the path-safety gate for all
 * file reads/writes (rejects traversal, out-of-bucket, and symlink-routed paths).
 */
export function validatePath(requestedPath: string) {
  const resolvedPath = path.resolve(workspaceRoot, requestedPath);

  let fullPath: string;
  try {
    fullPath = fs.realpathSync(resolvedPath);

    // TOCTOU guard: reject if the resolved target itself is a symlink
    const lstat = fs.lstatSync(fullPath);
    if (lstat.isSymbolicLink()) {
      throw new Error(`Security violation: Path ${requestedPath} resolves through a symbolic link.`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('Security violation')) throw e;

    // Path does not exist yet; walk parent segments to detect symlinks
    fullPath = resolvedPath;
    if (containsSymlink(fullPath, workspaceRoot)) {
      throw new Error(`Security violation: Path ${requestedPath} contains a symbolic link component.`);
    }
  }

  // Additional symlink check on the full resolved path components
  if (containsSymlink(fullPath, workspaceRoot)) {
    throw new Error(`Security violation: Path ${requestedPath} contains a symbolic link component.`);
  }

  const relativePath = path.relative(workspaceRoot, fullPath);

  // Security check: must be within the workspace root
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Security violation: Path ${requestedPath} is outside the allowed ContextOS workspace root.`);
  }

  // Enterprise check: must be within an allowed bucket
  const isAllowed = ALLOWED_BUCKETS.some(bucket => {
    const bucketRoot = path.join(workspaceRoot, bucket);
    const bucketRelative = path.relative(bucketRoot, fullPath);
    return !bucketRelative.startsWith("..") && !path.isAbsolute(bucketRelative);
  });

  if (!isAllowed) {
    throw new Error(`Security violation: Path ${requestedPath} is outside the allowed bucket (projects, orgs, knowledge, schemas, etc).`);
  }

  return { fullPath, relativePath };
}

/**
 * Checks if a path is in a read-only bucket for agents.
 *
 * MUST be called before any file write — callers are required to reject writes
 * to read-only buckets. Internally runs validatePath() first.
 */
export function isReadOnly(filePath: string): boolean {
  const { fullPath } = validatePath(filePath);
  
  const readOnlyBuckets = ["knowledge", "schemas", "root", "packages", "workspace-cli", "workspace-mcp", "workspace-dashboard"];
  return readOnlyBuckets.some(bucket => {
    const bucketRoot = path.join(workspaceRoot, bucket);
    const bucketRelative = path.relative(bucketRoot, fullPath);
    return !bucketRelative.startsWith("..") && !path.isAbsolute(bucketRelative);
  });
}

/**
 * Executes an atomic git transaction (Add + Commit).
 */
export async function gitCommit(filePath: string, message: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const add = spawn("git", ["add", filePath], { cwd: workspaceRoot });
        add.on("close", (code: number | null) => {
            if (code !== 0 && code !== null) {
                return reject(new Error(`Git add failed with code ${code}`));
            }
            const commit = spawn("git", ["commit", "-m", message], { cwd: workspaceRoot });
            commit.on("close", (code: number | null) => {
                // If code is not 0, it might be "nothing to commit" which is fine for our tools
                resolve();
            });
        });
    });
}
