import type Database from 'better-sqlite3';

export interface DBRecord {
  id?: number;
  path: string;
  title: string;
  content: string;
  excerpt: string;
  mtime: number;
  metadata: string;
  intelligence_status?: string;
  status?: string;
  is_private?: number;
}

export interface EdgeRecord {
  id?: number;
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface LockRecord {
  path: string;
  agent_id: string;
  expires_at: number;
  created_at: number;
  mode: 'read' | 'write';
}

export interface MissionRecord {
  id?: number;
  path: string;
  title: string;
  status: string;
  priority: number;
  created_at: number;
  due_at?: number;
  metadata?: string;
}

export interface QueueItem {
  id: number;
  doc_id: number;
  priority?: number;
  retry_count?: number;
  last_error?: string;
}

export interface AccessLogEntry {
  id: number;
  path: string;
  action: 'read' | 'write' | 'focus';
  timestamp: number;
}

export type RawDB = Database.Database;
