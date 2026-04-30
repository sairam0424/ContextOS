export interface NodeData {
  id: string;
  label: string;
  type: 'file' | 'tag' | 'mention' | 'symbol' | 'document' | 'entity' | 'mission';
  val?: number; // size for force graph
  color?: string;
  metadata?: {
    excerpt?: string;
    priority?: string;
    timestamp?: string;
    path?: string;
    line?: number;
    symbolType?: string;
    signature?: string;
    intelligenceStatus?: 'pending' | 'processing' | 'ready';
    // Aether 2.0 Additions
    heat?: number;
    lock?: boolean;
    actions?: string[];
    status?: string;
    bucket?: string;
  };
}

export interface EdgeData {
  source: string;
  target: string;
  type: 'tag' | 'mention' | 'semantic' | 'code-ref' | 'contains';
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
