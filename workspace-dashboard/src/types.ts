export interface LockRecord {
  agent_id: string;
  expires_at?: number;
}

export interface NodeData {
  id: string;
  label: string;
  type:
    | "file"
    | "tag"
    | "mention"
    | "symbol"
    | "document"
    | "entity"
    | "mission"
    | "bucket";
  val?: number;
  color?: string;
  metadata?: {
    excerpt?: string;
    priority?: string;
    timestamp?: string;
    path?: string;
    line?: number;
    symbolType?: string;
    signature?: string;
    intelligenceStatus?:
      "pending" | "processing" | "ready" | "failed" | "repairing" | "error";
    // Aether 2.0+
    heat?: number;
    lock?: LockRecord | boolean;
    actions?: string[];
    status?: string;
    bucket?: string;
    bucketId?: string;
    is_private?: boolean;
  };
}

export interface EdgeData {
  source: string;
  target: string;
  type: "tag" | "mention" | "semantic" | "code-ref" | "contains";
  weight: number;
}

export interface GraphData {
  nodes: NodeData[];
  links: EdgeData[];
}

export interface PulseData {
  healthScore: number;
  totalNodes: number;
  topTags: string[];
  recentChanges: string[];
  intelligenceStatus: {
    pending: number;
    processing: number;
    ready: number;
  };
}

// Wire protocol sent by the dashboard WebSocket server
// (workspace-cli/src/commands/dashboard.ts) - this is the actual, only
// producer of these messages, not an inferred/guessed shape.
export interface WsSyncEvent {
  type: string;
  path: string;
}

export type WsMessage =
  | { type: "init"; data: { pulse: PulseData; graph: GraphData } }
  | {
      type: "sync";
      data: { pulse: PulseData; graph: GraphData };
      event?: WsSyncEvent;
    }
  | { type: "agent_focus"; id: string }
  | { type: "lock_update"; path: string; locked: boolean; agentId: string }
  | { type: "connected" };
