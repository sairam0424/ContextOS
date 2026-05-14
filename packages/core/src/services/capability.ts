import fs from "fs-extra";
import path from "node:path";
import { getWorkspaceRoot } from "../context.js";

export interface CapabilityRecord {
  id: string;
  role: string;
  description?: string;
  expertise: string[];
  tools?: string[];
  affinity?: number;
}

/**
 * CapabilityService: Handlers the discovery and matching of agent capabilities
 * for the Swarm Protocol.
 */
export class CapabilityService {
  private capabilities: CapabilityRecord[] = [];
  private invertedIndex: Map<string, Set<string>> = new Map(); // term → set of capability ids

  constructor() {
    this.reload().catch(err => console.error("Failed to initialize CapabilityService:", err));
  }

  /**
   * Loads capabilities from capabilities.json in the workspace root.
   */
  public async reload() {
    const workspaceRoot = getWorkspaceRoot();
    const capPath = path.join(workspaceRoot, "capabilities.json");

    if (await fs.pathExists(capPath)) {
      try {
        const data = await fs.readJson(capPath);
        this.capabilities = Array.isArray(data) ? data : [data];
      } catch (err) {
        console.warn("[CapabilityService] Failed to parse capabilities.json, using defaults.");
        this.capabilities = this.getDefaultCapabilities();
      }
    } else {
      this.capabilities = this.getDefaultCapabilities();
    }

    this.buildIndex();
  }

  /** Build inverted index over expertise terms for TF-IDF scoring. */
  private buildIndex() {
    this.invertedIndex.clear();
    for (const cap of this.capabilities) {
      for (const term of cap.expertise) {
        if (term === '*') continue;
        const key = term.toLowerCase();
        if (!this.invertedIndex.has(key)) this.invertedIndex.set(key, new Set());
        this.invertedIndex.get(key)!.add(cap.id);
      }
    }
  }

  /**
   * Finds the best matching capability for a given intent using TF-IDF scoring.
   * IDF = log(totalDocs / docsContainingTerm + 1). TF = term frequency in intent.
   */
  public match(intent: string): CapabilityRecord {
    const intentTokens = intent.toLowerCase().split(/\W+/).filter(Boolean);
    const totalDocs = this.capabilities.length;

    const scores = new Map<string, number>();

    for (const token of intentTokens) {
      const matchingIds = this.invertedIndex.get(token);
      if (!matchingIds) continue;
      const idf = Math.log(totalDocs / (matchingIds.size + 1));
      for (const id of matchingIds) {
        scores.set(id, (scores.get(id) ?? 0) + idf);
      }
    }

    // Wildcards always score minimally as fallback
    for (const cap of this.capabilities) {
      if (cap.expertise.includes('*') && !scores.has(cap.id)) {
        scores.set(cap.id, 0.01);
      }
    }

    let best: CapabilityRecord = this.capabilities[0];
    let bestScore = -Infinity;
    for (const cap of this.capabilities) {
      const score = (scores.get(cap.id) ?? 0) + (cap.affinity ?? 0) * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = cap;
      }
    }

    return best;
  }

  public getCapabilities(): CapabilityRecord[] {
    return this.capabilities;
  }

  private getDefaultCapabilities(): CapabilityRecord[] {
    return [
      {
        id: "core-architect",
        role: "General Architect",
        description: "Standard system-wide logic and architectural guidance.",
        expertise: ["*"],
        affinity: 0.5
      }
    ];
  }
}

export const capabilityService = new CapabilityService();
