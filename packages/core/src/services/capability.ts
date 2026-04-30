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
  }

  /**
   * Finds the best matching capability for a given query or intent.
   * Phase 3: Simple weighted keyword matching.
   */
  public match(intent: string): CapabilityRecord {
    const normalizedIntent = intent.toLowerCase();
    
    // Sort by specificity: exact matches first, then partials, then wildcard
    const sorted = [...this.capabilities].sort((a, b) => {
      const aMatch = a.expertise.some(e => normalizedIntent.includes(e.toLowerCase()));
      const bMatch = b.expertise.some(e => normalizedIntent.includes(e.toLowerCase()));
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });

    const match = sorted.find(cap => 
      cap.expertise.some(e => normalizedIntent.includes(e.toLowerCase()) || e === "*")
    );

    return match || this.capabilities[0];
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
