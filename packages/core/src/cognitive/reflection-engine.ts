import type { RawDB } from '../database/types.js';
import type { WorkspaceEventBus } from '../events/event-bus.js';
import type { Reflection } from './types.js';
import type { MemoryStream } from './memory-stream.js';

interface ReflectOpts {
  readonly agentId: string;
  readonly taskId: string;
  readonly trial: number;
  readonly observation: string;
  readonly diagnosis: string;
  readonly prescription: string;
}

interface ReflectionRow {
  readonly id: number;
  readonly agent_id: string;
  readonly task_id: string;
  readonly trial: number;
  readonly observation: string;
  readonly diagnosis: string;
  readonly prescription: string;
  readonly validated: number;
  readonly created_at: number;
}

function rowToReflection(row: ReflectionRow): Reflection {
  return {
    id: row.id,
    agentId: row.agent_id,
    taskId: row.task_id,
    trial: row.trial,
    observation: row.observation,
    diagnosis: row.diagnosis,
    prescription: row.prescription,
    validated: row.validated === 1,
    createdAt: row.created_at,
  };
}

export class ReflectionEngine {
  private readonly db: RawDB;
  private readonly eventBus: WorkspaceEventBus;
  private readonly memoryStream: MemoryStream;

  constructor(db: RawDB, eventBus: WorkspaceEventBus, memoryStream: MemoryStream) {
    this.db = db;
    this.eventBus = eventBus;
    this.memoryStream = memoryStream;
  }

  reflect(opts: ReflectOpts): Reflection {
    const createdAt = Date.now();

    const result = this.db.prepare(
      'INSERT INTO reflections (agent_id, task_id, trial, observation, diagnosis, prescription, validated, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
    ).run(
      opts.agentId,
      opts.taskId,
      opts.trial,
      opts.observation,
      opts.diagnosis,
      opts.prescription,
      createdAt
    );

    const id = Number(result.lastInsertRowid);

    this.memoryStream.observe(opts.agentId, opts.prescription, {
      type: 'reflection',
      importance: 0.9,
    });

    this.eventBus.emit({
      type: 'memory.reflected',
      agentId: opts.agentId,
      reflectionId: id,
    } as any);

    return {
      id,
      agentId: opts.agentId,
      taskId: opts.taskId,
      trial: opts.trial,
      observation: opts.observation,
      diagnosis: opts.diagnosis,
      prescription: opts.prescription,
      validated: false,
      createdAt,
    };
  }

  getReflectionsForTask(taskId: string): Reflection[] {
    const rows = this.db.prepare(
      'SELECT * FROM reflections WHERE task_id = ? ORDER BY trial ASC'
    ).all(taskId) as ReflectionRow[];
    return rows.map(rowToReflection);
  }

  getRelevantReflections(agentId: string, taskDescription: string, limit = 3): Reflection[] {
    const rows = this.db.prepare(
      'SELECT * FROM reflections WHERE agent_id = ? ORDER BY created_at DESC'
    ).all(agentId) as ReflectionRow[];
    const reflections = rows.map(rowToReflection);

    const scored = reflections.map(reflection => ({
      reflection,
      score: this.textOverlap(
        taskDescription,
        `${reflection.observation} ${reflection.prescription}`
      ),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(entry => entry.reflection);
  }

  validate(reflectionId: number): void {
    this.db.prepare('UPDATE reflections SET validated = 1 WHERE id = ?').run(reflectionId);
  }

  getValidatedReflections(agentId: string, limit = 10): Reflection[] {
    const rows = this.db.prepare(
      'SELECT * FROM reflections WHERE agent_id = ? AND validated = 1 ORDER BY created_at DESC LIMIT ?'
    ).all(agentId, limit) as ReflectionRow[];
    return rows.map(rowToReflection);
  }

  buildAugmentedContext(agentId: string, taskDescription: string): string {
    const relevant = this.getRelevantReflections(agentId, taskDescription, 3);

    if (relevant.length === 0) {
      return taskDescription;
    }

    const prescriptions = relevant
      .map(r => `- ${r.prescription}`)
      .join('\n');

    return `Past learnings:\n${prescriptions}\n\nOriginal task: ${taskDescription}`;
  }

  private textOverlap(a: string, b: string): number {
    const tokenize = (text: string): Set<string> => {
      const words = text.toLowerCase().split(/\s+/);
      return new Set(words.filter(word => word.length > 2));
    };

    const tokensA = tokenize(a);
    const tokensB = tokenize(b);

    if (tokensA.size === 0 || tokensB.size === 0) {
      return 0;
    }

    let shared = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) {
        shared++;
      }
    }

    return shared / Math.max(tokensA.size, tokensB.size);
  }
}
