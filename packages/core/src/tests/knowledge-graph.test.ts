import assert from 'node:assert';
import { KnowledgeGraphService } from '../services/knowledge-graph.js';
import { getSharedDatabase } from '../services/database.js';

describe('KnowledgeGraphService', () => {
    const db = getSharedDatabase();
    const prefix = 'test-graph-' + Date.now();

    before(() => {
        db.upsertDocument({
            path: `${prefix}-a.md`, title: 'Doc A', content: 'Alpha content',
            excerpt: 'Alpha', mtime: Date.now(), metadata: '["alpha"]'
        });
        db.upsertDocument({
            path: `${prefix}-b.md`, title: 'Doc B', content: 'Beta content',
            excerpt: 'Beta', mtime: Date.now(), metadata: '["beta"]'
        });
        db.upsertEdge(`${prefix}-a.md`, `${prefix}-b.md`, 'mention', 1.0);
        db.upsertEdge(`${prefix}-a.md`, 'tag:alpha', 'tag', 1.0);
        db.upsertSymbol(`${prefix}Func`, `${prefix}-a.md`, 10, 'function', 'export function test()', 'abc123');
    });

    after(() => {
        db.removeDocument(`${prefix}-a.md`);
        db.removeDocument(`${prefix}-b.md`);
        db.removeEdgesForSource(`${prefix}-a.md`);
        db.removeEdgesForSource(`${prefix}-b.md`);
        db.removeSymbolsForPath(`${prefix}-a.md`);
    });

    it('should build a graph with document nodes', async () => {
        const graphService = new KnowledgeGraphService(db);
        const graph = await graphService.getGraph();
        const docNode = graph.nodes.find(n => n.id === `${prefix}-a.md`);
        assert.ok(docNode, 'Should contain document node');
        assert.strictEqual(docNode!.type, 'document');
    });

    it('should include symbol nodes', async () => {
        const graphService = new KnowledgeGraphService(db);
        const graph = await graphService.getGraph();
        const symNode = graph.nodes.find(n => n.id === `symbol:${prefix}Func`);
        assert.ok(symNode, 'Should contain symbol node');
        assert.strictEqual(symNode!.type, 'symbol');
    });

    it('should include tag virtual nodes', async () => {
        const graphService = new KnowledgeGraphService(db);
        const graph = await graphService.getGraph();
        const tagNode = graph.nodes.find(n => n.id === 'tag:alpha');
        assert.ok(tagNode, 'Should contain tag node');
        assert.strictEqual(tagNode!.type, 'tag');
    });

    it('should include edges between documents', async () => {
        const graphService = new KnowledgeGraphService(db);
        const graph = await graphService.getGraph();
        const mentionEdge = graph.edges.find(
            e => e.source === `${prefix}-a.md` && e.target === `${prefix}-b.md`
        );
        assert.ok(mentionEdge, 'Should contain mention edge');
        assert.strictEqual(mentionEdge!.type, 'mention');
    });
});
