import { DatabaseService } from "./database.js";
import { getWorkspaceRoot } from "../context.js";

export interface GraphNode {
    id: string; // filePath
    label: string; // title
    type: 'document' | 'entity' | 'tag';
    metadata: any;
}

export interface GraphEdge {
    source: string;
    target: string;
    type: 'mention' | 'tag' | 'semantic';
    weight: number;
}

export interface WorkspaceGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export class KnowledgeGraphService {
    private dbService: DatabaseService;

    constructor(dbService?: DatabaseService) {
        this.dbService = dbService || new DatabaseService(getWorkspaceRoot());
    }

    /**
     * Builds a unified graph of the workspace.
     * Combines explicit links (@mentions, #tags) and semantic bridges.
     */
    async getGraph(): Promise<WorkspaceGraph> {
        const nodes: GraphNode[] = [];
        const seenNodes = new Set<string>();

        // 1. Load all documents from the database
        const docs = this.dbService.getAllDocuments();

        for (const doc of docs) {
            // Add Document Node
            if (!seenNodes.has(doc.path)) {
                nodes.push({
                    id: doc.path,
                    label: doc.title,
                    type: 'document',
                    metadata: { excerpt: doc.excerpt }
                });
                seenNodes.add(doc.path);
            }
        }

        // 2. Load all persistent edges
        const dbEdges = this.dbService.getAllEdges();
        const edges: GraphEdge[] = dbEdges.map(e => ({
            source: e.source,
            target: e.target,
            type: e.type,
            weight: e.weight
        }));

        // 3. Add virtual nodes for tags that don't have documents
        edges.forEach(edge => {
            if (edge.type === 'tag' && !seenNodes.has(edge.target)) {
                nodes.push({
                    id: edge.target,
                    label: edge.target.replace('tag:', ''),
                    type: 'tag',
                    metadata: {}
                });
                seenNodes.add(edge.target);
            }
        });

        return { nodes, edges };
    }
}

export const knowledgeGraphService = new KnowledgeGraphService();
