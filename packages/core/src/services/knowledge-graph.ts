import { DatabaseService, getSharedDatabase } from "../database/index.js";

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
    private cache: { graph: WorkspaceGraph; version: number } | null = null;

    constructor(dbService?: DatabaseService) {
        this.dbService = dbService || getSharedDatabase();
    }

    /**
     * Builds a unified graph of the workspace.
     * Returns an in-memory cached result when the graph version is unchanged (O(1) on idle workspaces).
     */
    async getGraph(): Promise<WorkspaceGraph> {
        const currentVersion = this.dbService.getGraphVersion();
        if (this.cache && this.cache.version === currentVersion) {
            return this.cache.graph;
        }
        const nodes: GraphNode[] = [];
        const seenNodes = new Set<string>();
        const bucketsSeen = new Set<string>();

        // 1. Load all documents from the database
        const docs = this.dbService.getAllDocuments();

        for (const doc of docs) {
            // Derive bucket from first path segment for AetherGraph clustering (bug B6)
            const bucketId = doc.path.split('/')[0] || 'root';

            // Emit a bucket node once per distinct bucket
            if (!bucketsSeen.has(bucketId)) {
                nodes.push({
                    id: `bucket:${bucketId}`,
                    label: bucketId,
                    type: 'bucket' as any,
                    metadata: { val: 50 }
                });
                bucketsSeen.add(bucketId);
            }

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
                        lock: this.dbService.getLock(doc.path),
                        bucketId: `bucket:${bucketId}`
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

        // 5. Emit mission nodes (v2.0) — activates orange dodecahedra in the HUD
        const missions = this.dbService.getAllMissions();
        for (const mission of missions) {
            const missionId = `mission:${mission.path}`;
            if (!seenNodes.has(missionId)) {
                nodes.push({
                    id: missionId,
                    label: mission.title,
                    type: 'mission' as any,
                    metadata: { status: mission.status, priority: mission.priority, path: mission.path }
                });
                seenNodes.add(missionId);
                // Edge linking mission to its owning document if it exists
                if (seenNodes.has(mission.path)) {
                    edges.push({ source: missionId, target: mission.path, type: 'contains', weight: 1.0 });
                }
            }
        }

        // 6. Add virtual nodes for tags or documents that might be missing (e.g. from edges)
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

        const graph = { nodes, edges };
        this.cache = { graph, version: currentVersion };
        return graph;
    }
}

export const knowledgeGraphService = new KnowledgeGraphService();
