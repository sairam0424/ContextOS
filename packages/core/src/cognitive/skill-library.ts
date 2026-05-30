import type { RawDB } from '../database/types.js';
import type { Skill, SkillExecutionResult } from './types.js';

interface SkillRow {
  id: number;
  name: string;
  description: string;
  code: string;
  prerequisites: string;
  success_count: number;
  failure_count: number;
  last_used_at: number;
  created_by: string;
  version: number;
}

interface StoreOptions {
  readonly name: string;
  readonly description: string;
  readonly code: string;
  readonly prerequisites?: string[];
  readonly createdBy: string;
}

function rowToSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    code: row.code,
    prerequisites: JSON.parse(row.prerequisites) as string[],
    successCount: row.success_count,
    failureCount: row.failure_count,
    lastUsedAt: row.last_used_at,
    createdBy: row.created_by,
    version: row.version,
  };
}

function computeTextOverlap(query: string, text: string): number {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const textLower = text.toLowerCase();
  let matchCount = 0;
  for (const token of queryTokens) {
    if (textLower.includes(token)) {
      matchCount++;
    }
  }
  return queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
}

export class SkillLibrary {
  constructor(private readonly db: RawDB) {}

  store(opts: StoreOptions): Skill {
    const now = Date.now();
    const prerequisites = JSON.stringify(opts.prerequisites ?? []);
    const existing = this.db.prepare('SELECT * FROM skills WHERE name = ?').get(opts.name) as SkillRow | undefined;

    if (existing) {
      this.db.prepare(
        'UPDATE skills SET description = ?, code = ?, prerequisites = ?, version = version + 1, last_used_at = ? WHERE name = ?'
      ).run(opts.description, opts.code, prerequisites, now, opts.name);
    } else {
      this.db.prepare(
        'INSERT INTO skills (name, description, code, prerequisites, success_count, failure_count, last_used_at, created_by, version) VALUES (?, ?, ?, ?, 0, 0, ?, ?, 1)'
      ).run(opts.name, opts.description, opts.code, prerequisites, now, opts.createdBy);
    }

    return rowToSkill(this.db.prepare('SELECT * FROM skills WHERE name = ?').get(opts.name) as SkillRow);
  }

  search(query: string, limit: number = 5): Skill[] {
    const rows = this.db.prepare('SELECT * FROM skills').all() as SkillRow[];

    const scored = rows.map((row) => {
      const textScore = computeTextOverlap(query, row.name + ' ' + row.description);
      const successRate = row.success_count / (row.success_count + row.failure_count + 1);
      const combinedScore = textScore + successRate * 0.3;
      return { row, score: combinedScore };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((entry) => rowToSkill(entry.row));
  }

  getByName(name: string): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as SkillRow | undefined;
    return row ? rowToSkill(row) : null;
  }

  getAll(limit: number = 50): Skill[] {
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY last_used_at DESC LIMIT ?').all(limit) as SkillRow[];
    return rows.map(rowToSkill);
  }

  recordExecution(result: SkillExecutionResult): void {
    const now = Date.now();
    if (result.success) {
      this.db.prepare('UPDATE skills SET success_count = success_count + 1, last_used_at = ? WHERE id = ?').run(now, result.skillId);
    } else {
      this.db.prepare('UPDATE skills SET failure_count = failure_count + 1 WHERE id = ?').run(result.skillId);
    }
  }

  getPrerequisites(skillName: string): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const traverse = (name: string): void => {
      if (visited.has(name)) {
        return;
      }
      visited.add(name);

      const skill = this.getByName(name);
      if (!skill) {
        return;
      }

      for (const prereq of skill.prerequisites) {
        traverse(prereq);
      }

      if (name !== skillName) {
        result.push(name);
      }
    };

    traverse(skillName);
    return result;
  }

  compose(name: string, description: string, skillNames: string[], createdBy: string): Skill {
    for (const skillName of skillNames) {
      const existing = this.getByName(skillName);
      if (!existing) {
        throw new Error(`Component skill not found: ${skillName}`);
      }
    }

    const code = JSON.stringify({ type: 'composite', steps: skillNames });

    return this.store({
      name,
      description,
      code,
      prerequisites: skillNames,
      createdBy,
    });
  }

  prune(maxFailureRate: number = 0.8, minExecutions: number = 5): number {
    const result = this.db.prepare(
      'DELETE FROM skills WHERE (failure_count * 1.0 / (success_count + failure_count)) > ? AND (success_count + failure_count) >= ?'
    ).run(maxFailureRate, minExecutions);
    return result.changes;
  }
}
