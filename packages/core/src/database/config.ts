import type { RawDB } from './types.js';

export class ConfigRepository {
  constructor(private db: RawDB) {}

  get(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM workspace_config WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO workspace_config (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  getNumber(key: string, defaultValue: number): number {
    const val = this.get(key);
    return val ? parseInt(val, 10) : defaultValue;
  }
}
