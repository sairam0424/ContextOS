import { DatabaseService, getSharedDatabase } from "./database.js";

export interface GraphNode {
    id: string; // filePath or symbol:name
    label: string; // title
    type: 'document' | 'entity' | 'tag' | 'symbol';
    metadata: any;
}

export interface GraphEdge {
    source: string;
    target: string;
    type: 'mention' | 'tag' | 'semantic' | 'code-ref' | 'contains';
    weight: number;
}

export interface WorkspaceGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export class KnowledgeGraphService {
    private dbService: DatabaseService;

    constructor(dbService?: DatabaseService) {
        this.dbService = dbService || getSharedDatabase();
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
                    metadata: { 
                        excerpt: doc.excerpt,
                        intelligenceStatus: doc.intelligence_status || 'pending',
                        heat: this.dbService.getPathHeat(doc.path),
                        lock: this.dbService.getLock(doc.path)
                    }
                });
                seenNodes.add(doc.path);
            }
        }

        // 2. Load all persistent edges (mentions, tags, manual)
        const dbEdges = this.dbService.getAllEdges();
        const edges: GraphEdge[] = dbEdges.map(e => ({
            source: e.source,
            target: e.target,
            type: e.type,
            weight: e.weight
        }));

        // 3. Dynamic Semantic Pruning (v1.9.0 Top-K)
        // For each document, find its top 3 semantic neighbors and add a "virtual" edge
        for (const doc of docs) {
            if (doc.intelligence_status === 'ready') {
                const neighbors = this.dbService.getTopKNeighbors(doc.id!, 3);
                for (const neighbor of neighbors) {
                    // Only add if similarity is decent (e.g. distance < 0.25 which is ~0.75 similarity)
                    if (neighbor.distance < 0.25) {
                        edges.push({
                            source: doc.path,
                            target: neighbor.path,
                            type: 'semantic',
                            weight: 1.0 - neighbor.distance
                        });
                    }
                }
            }
        }

        // 4. Load all symbols and add them as virtual nodes
        const symbols = this.dbService.getAllSymbols();
        for (const symbol of symbols) {
            const symbolId = `symbol:${symbol.name}`;
            if (!seenNodes.has(symbolId)) {
                nodes.push({
                    id: symbolId,
                    label: symbol.name,
                    type: 'symbol',
                    metadata: { 
                        path: symbol.path, 
                        line: symbol.line, 
                        symbolType: symbol.type,
                        signature: symbol.signature
                    }
                });
                seenNodes.add(symbolId);
            }
        }

        // 5. Add virtual nodes for tags or documents that might be missing (e.g. from edges)
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
            
            // If a source/target is a file but not in documents (e.g. source code file)
            if (!seenNodes.has(edge.source) && !edge.source.startsWith('symbol:') && !edge.source.startsWith('tag:')) {
                nodes.push({
                    id: edge.source,
                    label: edge.source.split('/').pop() || edge.source,
                    type: 'entity',
                    metadata: { isFile: true }
                });
                seenNodes.add(edge.source);
            }
        });

        return { nodes, edges };
    }
}

export const knowledgeGraphService = new KnowledgeGraphService();
