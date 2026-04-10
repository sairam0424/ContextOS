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
        const edges: GraphEdge[] = [];
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

            // 2. Extract Explicit Links (Tags/Mentions from metadata JSON)
            const metadata = JSON.parse(doc.metadata || '[]');
            metadata.forEach((tag: string) => {
                const tagId = `tag:${tag}`;
                if (!seenNodes.has(tagId)) {
                    nodes.push({ id: tagId, label: tag, type: 'tag', metadata: {} });
                    seenNodes.add(tagId);
                }
                edges.push({ source: doc.path, target: tagId, type: 'tag', weight: 1.0 });
            });

            // 3. Find Semantic Bridges (similarity > 0.85)
            // We'll query for similar documents for each doc
            if (doc.id !== undefined) {
                const vector = this.dbService.getVectorForDocument(doc.id);
                if (vector) {
                    const similar = this.dbService.searchSemantic(vector, 10);
                    similar.forEach((match: { path: string; distance: number }) => {
                        // Only bridge if similarity is high and it's not the same doc
                        if (match.path !== doc.path && (1 - match.distance) > 0.85) {
                            edges.push({
                                source: doc.path,
                                target: match.path,
                                type: 'semantic',
                                weight: 1 - match.distance
                            });
                        }
                    });
                }
            }
        }

        return { nodes, edges };
    }
}

export const knowledgeGraphService = new KnowledgeGraphService();
