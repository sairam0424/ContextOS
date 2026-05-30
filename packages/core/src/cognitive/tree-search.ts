import type { TreeNode, LATSConfig } from './types.js';

const DEFAULT_CONFIG: LATSConfig = {
  maxDepth: 5,
  explorationConstant: 1.414,
  maxIterations: 50,
  branchingFactor: 3,
};

export class LanguageAgentTreeSearch {
  private nodes: Map<string, TreeNode> = new Map();
  private rootId: string | null = null;
  private readonly config: LATSConfig;
  private iterationCount = 0;

  constructor(config?: Partial<LATSConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  initialize(rootState: string): string {
    const id = this.generateId();
    const rootNode: TreeNode = {
      id,
      parentId: null,
      state: rootState,
      action: '',
      value: 0,
      visits: 0,
      children: [],
      depth: 0,
      isTerminal: false,
    };
    this.nodes = new Map([[id, rootNode]]);
    this.rootId = id;
    this.iterationCount = 0;
    return id;
  }

  expand(nodeId: string, actions: string[], states: string[]): string[] {
    const parent = this.nodes.get(nodeId);
    if (!parent) {
      return [];
    }

    const childIds: string[] = [];

    for (let i = 0; i < actions.length; i++) {
      const childId = this.generateId();
      const childNode: TreeNode = {
        id: childId,
        parentId: nodeId,
        state: states[i],
        action: actions[i],
        value: 0,
        visits: 0,
        children: [],
        depth: parent.depth + 1,
        isTerminal: parent.depth + 1 >= this.config.maxDepth,
      };
      this.nodes.set(childId, childNode);
      childIds.push(childId);
    }

    const updatedParent: TreeNode = {
      ...parent,
      children: [...parent.children, ...childIds],
    };
    this.nodes.set(nodeId, updatedParent);

    return childIds;
  }

  select(): string | null {
    if (!this.rootId) {
      return null;
    }

    let currentId = this.rootId;

    while (true) {
      const current = this.nodes.get(currentId);
      if (!current) {
        return null;
      }

      if (current.children.length === 0 || current.depth >= this.config.maxDepth) {
        this.iterationCount++;
        return currentId;
      }

      let bestScore = -Infinity;
      let bestChildId = current.children[0];

      for (const childId of current.children) {
        const child = this.nodes.get(childId);
        if (!child) {
          continue;
        }
        const score = this.uctScore(current, child);
        if (score > bestScore) {
          bestScore = score;
          bestChildId = childId;
        }
      }

      currentId = bestChildId;
    }
  }

  backpropagate(nodeId: string, reward: number): void {
    let currentId: string | null = nodeId;

    while (currentId !== null) {
      const node = this.nodes.get(currentId);
      if (!node) {
        return;
      }

      const updatedNode: TreeNode = {
        ...node,
        visits: node.visits + 1,
        value: node.value + reward,
      };
      this.nodes.set(currentId, updatedNode);

      currentId = node.parentId;
    }
  }

  getBestTrajectory(): TreeNode[] {
    if (!this.rootId) {
      return [];
    }

    const trajectory: TreeNode[] = [];
    let currentId: string | null = this.rootId;

    while (currentId !== null) {
      const current = this.nodes.get(currentId);
      if (!current) {
        break;
      }

      trajectory.push(current);

      if (current.children.length === 0) {
        break;
      }

      let bestAverageValue = -Infinity;
      let bestChildId: string | null = null;

      for (const childId of current.children) {
        const child = this.nodes.get(childId);
        if (!child || child.visits === 0) {
          continue;
        }
        const averageValue = child.value / child.visits;
        if (averageValue > bestAverageValue) {
          bestAverageValue = averageValue;
          bestChildId = childId;
        }
      }

      currentId = bestChildId;
    }

    return trajectory;
  }

  getBestAction(): { action: string; state: string; confidence: number } | null {
    if (!this.rootId) {
      return null;
    }

    const root = this.nodes.get(this.rootId);
    if (!root || root.children.length === 0) {
      return null;
    }

    let bestVisits = -1;
    let bestChild: TreeNode | null = null;
    let totalChildVisits = 0;

    for (const childId of root.children) {
      const child = this.nodes.get(childId);
      if (!child) {
        continue;
      }
      totalChildVisits += child.visits;
      if (child.visits > bestVisits) {
        bestVisits = child.visits;
        bestChild = child;
      }
    }

    if (!bestChild || totalChildVisits === 0) {
      return null;
    }

    return {
      action: bestChild.action,
      state: bestChild.state,
      confidence: bestChild.visits / totalChildVisits,
    };
  }

  getNode(nodeId: string): TreeNode | null {
    return this.nodes.get(nodeId) ?? null;
  }

  getStats(): { totalNodes: number; maxDepth: number; rootVisits: number; iterations: number } {
    let maxDepthFound = 0;
    for (const node of this.nodes.values()) {
      if (node.depth > maxDepthFound) {
        maxDepthFound = node.depth;
      }
    }

    const rootVisits = this.rootId
      ? (this.nodes.get(this.rootId)?.visits ?? 0)
      : 0;

    return {
      totalNodes: this.nodes.size,
      maxDepth: maxDepthFound,
      rootVisits,
      iterations: this.iterationCount,
    };
  }

  reset(): void {
    this.nodes = new Map();
    this.rootId = null;
    this.iterationCount = 0;
  }

  private uctScore(parent: TreeNode, child: TreeNode): number {
    const exploitation = child.value / (child.visits + 1);
    const exploration =
      this.config.explorationConstant *
      Math.sqrt(Math.log(parent.visits + 1) / (child.visits + 1));
    return exploitation + exploration;
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
