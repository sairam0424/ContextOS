import { execFileSync } from 'node:child_process';
import type { RawDB } from '../database/types.js';

export interface CoChangeEdge {
  readonly source: string;
  readonly target: string;
  readonly frequency: number;
  readonly lastCoChange: number;
  readonly authors: readonly string[];
}

export interface FileOwnership {
  readonly path: string;
  readonly primaryAuthor: string;
  readonly authorShares: Record<string, number>;
  readonly lastModified: number;
}

export interface ChangeVelocity {
  readonly path: string;
  readonly commitsPerWeek: number;
  readonly riskLevel: 'low' | 'medium' | 'high';
}

interface ParsedCommit {
  readonly hash: string;
  readonly author: string;
  readonly timestamp: number;
  readonly files: readonly string[];
}

export class GitIntelligenceService {
  private readonly db: RawDB;
  private readonly workspaceRoot: string;

  constructor(db: RawDB, workspaceRoot: string) {
    this.db = db;
    this.workspaceRoot = workspaceRoot;
  }

  analyzeCoChanges(maxCommits = 200): number {
    const commits = this.parseGitLog(maxCommits);
    let edgesModified = 0;

    const upsert = this.db.prepare(
      `INSERT INTO co_change_edges (source, target, frequency, last_co_change, authors)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source, target) DO UPDATE SET
         frequency = frequency + 1,
         last_co_change = excluded.last_co_change,
         authors = excluded.authors`
    );

    const getExisting = this.db.prepare(
      `SELECT authors FROM co_change_edges WHERE source = ? AND target = ?`
    );

    const transaction = this.db.transaction(() => {
      for (const commit of commits) {
        if (commit.files.length < 2) continue;

        for (let i = 0; i < commit.files.length; i++) {
          for (let j = i + 1; j < commit.files.length; j++) {
            const source = commit.files[i];
            const target = commit.files[j];

            const existing = getExisting.get(source, target) as
              | { authors: string }
              | undefined;

            const existingAuthors: string[] = existing
              ? JSON.parse(existing.authors)
              : [];

            const mergedAuthors = existingAuthors.includes(commit.author)
              ? existingAuthors
              : [...existingAuthors, commit.author];

            upsert.run(
              source,
              target,
              1,
              commit.timestamp,
              JSON.stringify(mergedAuthors)
            );
            edgesModified++;
          }
        }
      }
    });

    transaction();
    return edgesModified;
  }

  analyzeOwnership(maxCommits = 200): FileOwnership[] {
    const commits = this.parseGitLog(maxCommits);
    const fileAuthorCounts = new Map<string, Map<string, number>>();
    const fileLastModified = new Map<string, number>();

    for (const commit of commits) {
      for (const file of commit.files) {
        const authorCounts = fileAuthorCounts.get(file) ?? new Map<string, number>();
        authorCounts.set(commit.author, (authorCounts.get(commit.author) ?? 0) + 1);
        fileAuthorCounts.set(file, authorCounts);

        const current = fileLastModified.get(file) ?? 0;
        if (commit.timestamp > current) {
          fileLastModified.set(file, commit.timestamp);
        }
      }
    }

    const results: FileOwnership[] = [];

    const upsert = this.db.prepare(
      `INSERT INTO file_ownership (path, primary_author, author_shares, last_modified)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         primary_author = excluded.primary_author,
         author_shares = excluded.author_shares,
         last_modified = excluded.last_modified`
    );

    const transaction = this.db.transaction(() => {
      for (const [path, authorCounts] of fileAuthorCounts) {
        const totalCommits = Array.from(authorCounts.values()).reduce((a, b) => a + b, 0);
        let primaryAuthor = '';
        let maxCount = 0;

        const authorShares: Record<string, number> = {};
        for (const [author, count] of authorCounts) {
          authorShares[author] = Math.round((count / totalCommits) * 100);
          if (count > maxCount) {
            maxCount = count;
            primaryAuthor = author;
          }
        }

        const lastModified = fileLastModified.get(path) ?? 0;

        upsert.run(path, primaryAuthor, JSON.stringify(authorShares), lastModified);

        results.push(Object.freeze({ path, primaryAuthor, authorShares, lastModified }));
      }
    });

    transaction();
    return results;
  }

  getCoChanges(filePath: string, limit = 10): CoChangeEdge[] {
    const stmt = this.db.prepare(
      `SELECT source, target, frequency, last_co_change, authors
       FROM co_change_edges
       WHERE source = ? OR target = ?
       ORDER BY frequency DESC
       LIMIT ?`
    );

    const rows = stmt.all(filePath, filePath, limit) as Array<{
      source: string;
      target: string;
      frequency: number;
      last_co_change: number;
      authors: string;
    }>;

    return rows.map((row) =>
      Object.freeze({
        source: row.source,
        target: row.target,
        frequency: row.frequency,
        lastCoChange: row.last_co_change,
        authors: Object.freeze(JSON.parse(row.authors)) as readonly string[],
      })
    );
  }

  getOwnership(filePath: string): FileOwnership | null {
    const stmt = this.db.prepare(
      `SELECT path, primary_author, author_shares, last_modified
       FROM file_ownership
       WHERE path = ?`
    );

    const row = stmt.get(filePath) as
      | { path: string; primary_author: string; author_shares: string; last_modified: number }
      | undefined;

    if (!row) return null;

    return Object.freeze({
      path: row.path,
      primaryAuthor: row.primary_author,
      authorShares: JSON.parse(row.author_shares),
      lastModified: row.last_modified,
    });
  }

  getVelocity(filePath: string): ChangeVelocity {
    const output = execFileSync(
      'git',
      ['log', '--format=%at', '--follow', '--', filePath],
      { cwd: this.workspaceRoot, encoding: 'utf-8' }
    );

    const timestamps = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((ts) => parseInt(ts, 10) * 1000);

    const now = Date.now();
    const fourWeeksAgo = now - 28 * 24 * 60 * 60 * 1000;
    const recentCommits = timestamps.filter((ts) => ts >= fourWeeksAgo);
    const commitsPerWeek = recentCommits.length / 4;

    let riskLevel: 'low' | 'medium' | 'high';
    if (commitsPerWeek > 5) {
      riskLevel = 'high';
    } else if (commitsPerWeek >= 1) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    return Object.freeze({ path: filePath, commitsPerWeek, riskLevel });
  }

  getHotFiles(limit = 20): Array<{ path: string; totalChanges: number }> {
    const stmt = this.db.prepare(
      `SELECT path, SUM(changes) as total_changes FROM (
         SELECT source as path, SUM(frequency) as changes FROM co_change_edges GROUP BY source
         UNION ALL
         SELECT target as path, SUM(frequency) as changes FROM co_change_edges GROUP BY target
       ) GROUP BY path ORDER BY total_changes DESC LIMIT ?`
    );

    const rows = stmt.all(limit) as Array<{ path: string; total_changes: number }>;

    return rows.map((row) => Object.freeze({ path: row.path, totalChanges: row.total_changes }));
  }

  private parseGitLog(maxCommits: number): ParsedCommit[] {
    const output = execFileSync(
      'git',
      ['log', '--name-only', '--format=COMMIT:%H:%an:%at', `-n${maxCommits}`],
      { cwd: this.workspaceRoot, encoding: 'utf-8' }
    );

    const segments = output.split('COMMIT:').filter(Boolean);
    const commits: ParsedCommit[] = [];

    for (const segment of segments) {
      const lines = segment.trim().split('\n');
      if (lines.length === 0) continue;

      const headerParts = lines[0].split(':');
      if (headerParts.length < 3) continue;

      const hash = headerParts[0];
      const author = headerParts[1];
      const timestamp = parseInt(headerParts[2], 10) * 1000;

      const files = lines
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean);

      commits.push(Object.freeze({ hash, author, timestamp, files }));
    }

    return commits;
  }
}
