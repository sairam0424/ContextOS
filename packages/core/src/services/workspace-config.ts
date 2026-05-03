import { getSharedDatabase } from './database.js';
import { ALLOWED_BUCKETS } from '../context.js';

const DEFAULT_CONFIG: Record<string, string> = {
  'allowed_buckets': JSON.stringify(ALLOWED_BUCKETS),
  'janitor.maxRepairsPerHour': '20',
  'janitor.maxOutputTokens': '1024',
};

export class WorkspaceConfigService {
  private db = getSharedDatabase();

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults() {
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      if (this.db.getConfig(key) === undefined) {
        this.db.setConfig(key, value);
      }
    }
  }

  public get(key: string, defaultValue?: string): string | undefined {
    return this.db.getConfig(key) ?? defaultValue;
  }

  public set(key: string, value: string): void {
    this.db.setConfig(key, value);
  }

  public getNumber(key: string, defaultValue: number): number {
    const val = this.get(key);
    const parsed = val !== undefined ? Number(val) : NaN;
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  public getBuckets(): string[] {
    const raw = this.get('allowed_buckets');
    if (!raw) return ALLOWED_BUCKETS;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : ALLOWED_BUCKETS;
    } catch {
      return ALLOWED_BUCKETS;
    }
  }

  public setBuckets(buckets: string[]): void {
    this.set('allowed_buckets', JSON.stringify(buckets));
  }
}

let _sharedConfig: WorkspaceConfigService | null = null;

export function getWorkspaceConfig(): WorkspaceConfigService {
  if (!_sharedConfig) {
    _sharedConfig = new WorkspaceConfigService();
  }
  return _sharedConfig;
}

export const workspaceConfigService = getWorkspaceConfig();
