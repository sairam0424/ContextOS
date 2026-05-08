import { getSharedDatabase } from '../database/index.js';

export interface Mission {
  id: number;
  path: string;
  title: string;
  status: 'active' | 'completed' | 'paused' | 'archived';
  priority: number;
  created_at: number;
  due_at: number | null;
  metadata: string | null;
}

export class MissionService {
  private db = getSharedDatabase();

  public create(title: string, options: { priority?: number; dueAt?: number; metadata?: Record<string, unknown> } = {}): Mission {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const path = `missions/${slug}-${Date.now()}.md`;
    const metaStr = options.metadata ? JSON.stringify(options.metadata) : undefined;
    const result = this.db.createMission(title, path, options.priority ?? 1, options.dueAt, metaStr);
    return this.db.listMissions().find((m: any) => m.id === result.id) as Mission;
  }

  public list(status?: Mission['status']): Mission[] {
    return this.db.listMissions(status) as Mission[];
  }

  public complete(path: string): void {
    this.db.updateMissionStatus(path, 'completed');
  }

  public pause(path: string): void {
    this.db.updateMissionStatus(path, 'paused');
  }

  public archive(path: string): void {
    this.db.updateMissionStatus(path, 'archived');
  }

  public activate(path: string): void {
    this.db.updateMissionStatus(path, 'active');
  }
}

export const missionService = new MissionService();
