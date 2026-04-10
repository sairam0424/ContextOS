export interface NodeData {
  id: string;
  label: string;
  type: 'file' | 'tag' | 'mention';
  val: number; // size for force graph
  color?: string;
  metadata?: {
    excerpt?: string;
    priority?: string;
    timestamp?: string;
  };
}

export interface EdgeData {
  source: string;
  target: string;
  type: 'tag' | 'mention' | 'semantic';
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
}
