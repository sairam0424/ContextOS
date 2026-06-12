import assert from 'node:assert';
import { setTimeout as sleep } from 'node:timers/promises';
import { createTestDb, cleanupTestDb, type TestDB } from './helpers.js';
import { WorkspaceEventBus } from '../events/event-bus.js';
import { AgentRegistry } from '../agents/registry.js';
import { MessageBus } from '../agents/message-bus.js';
import { TaskScheduler } from '../orchestration/scheduler.js';
import { SwarmOrchestrator } from '../orchestration/swarm-orchestrator.js';
import { ConsensusService } from '../orchestration/consensus.js';
import { NegotiationService } from '../orchestration/negotiation.js';

// SwarmOrchestrator — Magentic-One dual-ledger (TaskLedger + ProgressLedger)
describe('SwarmOrchestrator (dual-ledger)', function () {
  this.timeout(10000);

  let testDb: TestDB;
  let eventBus: WorkspaceEventBus;
  let scheduler: TaskScheduler;
  let registry: AgentRegistry;
  let orchestrator: SwarmOrchestrator;

  beforeEach(() => {
    testDb = createTestDb('swarm-orch');
    eventBus = new WorkspaceEventBus();
    registry = new AgentRegistry(testDb.db, eventBus);
    const messageBus = new MessageBus(testDb.db, eventBus);
    scheduler = new TaskScheduler(testDb.db, registry, messageBus, eventBus);
    orchestrator = new SwarmOrchestrator(testDb.db, eventBus, scheduler, registry);
  });

  afterEach(() => {
    cleanupTestDb(testDb);
  });

  it('spawn creates a session with empty ledgers and active status', () => {
    const events: Array<{ type: string }> = [];
    eventBus.on('swarm.spawned' as any, (e: any) => events.push(e));

    const session = orchestrator.spawn('mission-A', { topology: 'peer_swarm' });

    // Session identity / config
    assert.strictEqual(session.missionId, 'mission-A');
    assert.strictEqual(session.topology, 'peer_swarm');
    assert.strictEqual(session.status, 'active');

    // TaskLedger starts empty with revisionCount 0
    assert.deepStrictEqual(session.taskLedger.facts, []);
    assert.deepStrictEqual(session.taskLedger.hypotheses, []);
    assert.deepStrictEqual(session.taskLedger.planSteps, []);
    assert.strictEqual(session.taskLedger.revisionCount, 0);
    assert.strictEqual(session.taskLedger.missionId, 'mission-A');

    // ProgressLedger starts at step 0 with no assignment / no stalls
    assert.strictEqual(session.progressLedger.currentStep, 0);
    assert.deepStrictEqual(session.progressLedger.completedSteps, []);
    assert.strictEqual(session.progressLedger.activeAssignment, null);
    assert.strictEqual(session.progressLedger.stallCount, 0);

    // Persisted and retrievable
    const fetched = orchestrator.getSession(session.id);
    assert.strictEqual(fetched?.id, session.id);
    assert.strictEqual(fetched?.status, 'active');

    // spawned event emitted exactly once
    assert.strictEqual(events.length, 1);
  });

  it('tick advances ProgressLedger.currentStep when a task is assigned', () => {
    registry.register({ name: 'worker-1', capabilities: ['code'] });
    const session = orchestrator.spawn('mission-progress', { tickIntervalMs: 5000 });
    scheduler.getGraph().addTask({ missionId: 'mission-progress', title: 'T1', description: 'work' });

    assert.strictEqual(orchestrator.tick(session.id), 'progressing');

    const after = orchestrator.getSession(session.id)!;
    // currentStep incremented from 0 -> 1 on a successful assignment
    assert.strictEqual(after.progressLedger.currentStep, 1);
    assert.strictEqual(after.progressLedger.stallCount, 0);
    assert.ok(after.progressLedger.activeAssignment);
    assert.strictEqual(after.status, 'active');
  });

  it('tick returns "complete" and marks session completed when all tasks done', () => {
    registry.register({ name: 'worker-c', capabilities: ['code'] });
    const session = orchestrator.spawn('mission-done');

    const graph = scheduler.getGraph();
    const task = graph.addTask({ missionId: 'mission-done', title: 'only', description: 'work' });
    graph.assign(task.id, registry.getActive()[0].id);
    graph.complete(task.id, { ok: true });

    assert.strictEqual(orchestrator.tick(session.id), 'complete');
    assert.strictEqual(orchestrator.getSession(session.id)!.status, 'completed');
  });

  it('tick on a non-active session returns "complete" without mutation', () => {
    const session = orchestrator.spawn('mission-aborted');
    orchestrator.abort(session.id, 'manual');

    const result = orchestrator.tick(session.id);
    assert.strictEqual(result, 'complete');
    assert.strictEqual(orchestrator.getSession(session.id)!.status, 'aborted');
  });

  it('tick on a missing session returns "complete"', () => {
    assert.strictEqual(orchestrator.tick('does-not-exist'), 'complete');
  });

  it('stall path: tick increments stallCount and flips to replanning at threshold', async () => {
    // tickIntervalMs=1 => stall window is 2ms; stallThreshold=1 => first stall replans.
    const session = orchestrator.spawn('mission-stall', { tickIntervalMs: 1, stallThreshold: 1 });

    const stalledEvents: Array<{ stallCount: number }> = [];
    eventBus.on('swarm.stalled' as any, (e: any) => stalledEvents.push(e));

    // Ensure wall clock advances past the stall window.
    await sleep(10);

    const result = orchestrator.tick(session.id);
    assert.strictEqual(result, 'replanning');

    const after = orchestrator.getSession(session.id)!;
    assert.strictEqual(after.status, 'replanning');
    assert.strictEqual(after.progressLedger.stallCount, 1);

    // Event reports the incremented stall count.
    assert.strictEqual(stalledEvents.length, 1);
    assert.strictEqual(stalledEvents[0].stallCount, 1);
  });

  it('stall path: below threshold returns "stalled" and only bumps stallCount', async () => {
    // stallThreshold=3 means stallCount 1 and 2 stay "stalled" (no replan).
    const session = orchestrator.spawn('mission-stall-2', { tickIntervalMs: 1, stallThreshold: 3 });

    await sleep(10);
    const r1 = orchestrator.tick(session.id);
    assert.strictEqual(r1, 'stalled');
    assert.strictEqual(orchestrator.getSession(session.id)!.progressLedger.stallCount, 1);

    await sleep(10);
    const r2 = orchestrator.tick(session.id);
    assert.strictEqual(r2, 'stalled');
    assert.strictEqual(orchestrator.getSession(session.id)!.progressLedger.stallCount, 2);

    // Session stays active while below the threshold.
    assert.strictEqual(orchestrator.getSession(session.id)!.status, 'active');
  });

  it('replan increments TaskLedger.revisionCount, appends facts, resets ProgressLedger', () => {
    const session = orchestrator.spawn('mission-replan', { maxReplans: 3 });

    const replannedEvents: Array<{ revisionCount: number }> = [];
    eventBus.on('swarm.replanned' as any, (e: any) => replannedEvents.push(e));

    const r1 = orchestrator.replan(session.id, ['fact-1', 'fact-2']);
    assert.ok(r1);
    assert.strictEqual(r1!.taskLedger.revisionCount, 1);
    assert.deepStrictEqual(r1!.taskLedger.facts, ['fact-1', 'fact-2']);
    assert.strictEqual(r1!.status, 'active');
    // Progress ledger reset to step 0 with cleared assignment.
    assert.strictEqual(r1!.progressLedger.currentStep, 0);
    assert.strictEqual(r1!.progressLedger.activeAssignment, null);
    assert.strictEqual(r1!.progressLedger.stallCount, 0);

    // A second replan accumulates facts and bumps revisionCount again.
    const r2 = orchestrator.replan(session.id, ['fact-3']);
    assert.ok(r2);
    assert.strictEqual(r2!.taskLedger.revisionCount, 2);
    assert.deepStrictEqual(r2!.taskLedger.facts, ['fact-1', 'fact-2', 'fact-3']);

    assert.strictEqual(replannedEvents.length, 2);
    assert.strictEqual(replannedEvents[1].revisionCount, 2);
  });

  it('replan is capped at maxReplans: it does NOT replan past the cap and aborts', () => {
    // maxReplans=2 => revisionCount can reach 1 then 2; the 3rd attempt aborts.
    const session = orchestrator.spawn('mission-cap', { maxReplans: 2 });

    const abortEvents: Array<{ reason?: string }> = [];
    eventBus.on('swarm.aborted' as any, (e: any) => abortEvents.push(e));

    const r1 = orchestrator.replan(session.id);
    assert.strictEqual(r1!.taskLedger.revisionCount, 1);

    const r2 = orchestrator.replan(session.id);
    assert.strictEqual(r2!.taskLedger.revisionCount, 2);

    // revisionCount (2) >= maxReplans (2) => abort, return null, NO further revision.
    const r3 = orchestrator.replan(session.id);
    assert.strictEqual(r3, null);

    const after = orchestrator.getSession(session.id)!;
    assert.strictEqual(after.status, 'aborted');
    // The capped attempt did NOT increment revisionCount beyond the cap.
    assert.strictEqual(after.taskLedger.revisionCount, 2);

    assert.strictEqual(abortEvents.length, 1);
    assert.strictEqual(abortEvents[0].reason, 'max_replans_exceeded');
  });

  it('replan on a missing session returns null', () => {
    assert.strictEqual(orchestrator.replan('no-such-session'), null);
  });

  it('getActiveSessions returns only active sessions', () => {
    const s1 = orchestrator.spawn('m1');
    const s2 = orchestrator.spawn('m2');
    orchestrator.complete(s2.id);
    const ids = orchestrator.getActiveSessions().map(s => s.id);
    assert.ok(ids.includes(s1.id));
    assert.ok(!ids.includes(s2.id));
  });
});

// ConsensusService — weighted voting, quorum gating
describe('ConsensusService', function () {
  this.timeout(10000);

  let testDb: TestDB;
  let eventBus: WorkspaceEventBus;
  let consensus: ConsensusService;

  beforeEach(() => {
    testDb = createTestDb('consensus');
    eventBus = new WorkspaceEventBus();
    consensus = new ConsensusService(testDb.db, eventBus);
  });

  afterEach(() => {
    cleanupTestDb(testDb);
  });

  it('propose -> accept -> commit auto-tallies a winner when quorum is met', () => {
    const decided: Array<{ winner: string | null }> = [];
    eventBus.on('consensus.decided' as any, (e: any) => decided.push(e));

    const req = consensus.propose({
      proposerId: 'agent-p',
      topic: 'pick-strategy',
      options: ['A', 'B'],
      quorum: 2,
    });
    assert.strictEqual(req.result, null);

    // First vote: count (1) < quorum (2) => no commit yet.
    consensus.vote(req.id, 'voter-1', 'A');
    assert.strictEqual(consensus.getRequest(req.id)!.result, null);
    assert.strictEqual(decided.length, 0);

    // Second vote reaches quorum => auto-tally commits the winner.
    consensus.vote(req.id, 'voter-2', 'A');
    const committed = consensus.getRequest(req.id)!;
    assert.strictEqual(committed.result, 'A');
    assert.strictEqual(decided.length, 1);
    assert.strictEqual(decided[0].winner, 'A');
  });

  it('does NOT commit below quorum: tally reports quorumReached=false, winner=null', () => {
    const req = consensus.propose({
      proposerId: 'agent-p',
      topic: 'gate',
      options: ['yes', 'no'],
      quorum: 3,
    });

    consensus.vote(req.id, 'v1', 'yes');
    consensus.vote(req.id, 'v2', 'yes');

    const result = consensus.tally(req.id);
    assert.strictEqual(result.totalVotes, 2);
    assert.strictEqual(result.quorumReached, false);
    assert.strictEqual(result.winner, null);
    // Persisted request still has no committed result.
    assert.strictEqual(consensus.getRequest(req.id)!.result, null);
  });

  it('tallies weighted votes correctly (hand-computed weighted sums)', () => {
    const req = consensus.propose({
      proposerId: 'agent-p',
      topic: 'weighted',
      options: ['A', 'B'],
      quorum: 3,
    });

    // A: 0.5 + 1.5 = 2.0 ; B: 2.25 (single heavier vote)
    consensus.vote(req.id, 'v1', 'A', 0.5);
    consensus.vote(req.id, 'v2', 'A', 1.5);
    consensus.vote(req.id, 'v3', 'B', 2.25);

    const result = consensus.tally(req.id);
    assert.strictEqual(result.totalVotes, 3);
    assert.strictEqual(result.quorumReached, true);
    // Hand-computed weighted breakdown.
    assert.strictEqual(result.breakdown['A'], 2.0);
    assert.strictEqual(result.breakdown['B'], 2.25);
    // B wins on weight (2.25 > 2.0) despite A having more raw votes.
    assert.strictEqual(result.winner, 'B');
  });

  it('re-voting (INSERT OR REPLACE) overwrites a voter prior choice/weight', () => {
    const req = consensus.propose({
      proposerId: 'agent-p',
      topic: 'revote',
      options: ['A', 'B'],
      quorum: 5, // high so no auto-tally fires
    });

    consensus.vote(req.id, 'v1', 'A', 3.0);
    consensus.vote(req.id, 'v1', 'B', 1.0); // same voter changes mind

    const votes = consensus.getVotes(req.id);
    assert.strictEqual(votes.length, 1); // not duplicated
    const result = consensus.tally(req.id);
    assert.strictEqual(result.breakdown['B'], 1.0);
    assert.strictEqual(result.breakdown['A'], undefined);
  });

  it('vote rejects an invalid choice not in options', () => {
    const req = consensus.propose({
      proposerId: 'agent-p',
      topic: 'bad-choice',
      options: ['A', 'B'],
      quorum: 1,
    });

    assert.throws(
      () => consensus.vote(req.id, 'v1', 'Z'),
      /Invalid choice "Z"/
    );
  });

  it('vote on a missing request throws', () => {
    assert.throws(
      () => consensus.vote('no-request', 'v1', 'A'),
      /Vote request not found/
    );
  });

  it('vote past the deadline throws', () => {
    const req = consensus.propose({
      proposerId: 'agent-p',
      topic: 'expired',
      options: ['A'],
      quorum: 1,
      deadlineMs: -1, // deadline already in the past
    });

    assert.throws(
      () => consensus.vote(req.id, 'v1', 'A'),
      /passed its deadline/
    );
  });
});

// NegotiationService — propose/counter/accept/reject lifecycle
describe('NegotiationService', function () {
  this.timeout(10000);

  let testDb: TestDB;
  let eventBus: WorkspaceEventBus;
  let negotiation: NegotiationService;

  beforeEach(() => {
    testDb = createTestDb('negotiation');
    eventBus = new WorkspaceEventBus();
    negotiation = new NegotiationService(testDb.db, eventBus);
  });

  afterEach(() => {
    cleanupTestDb(testDb);
  });

  it('offer -> counter-offer -> accept reaches agreement', () => {
    const resolved: Array<{ status: string }> = [];
    eventBus.on('negotiate.resolved' as any, (e: any) => resolved.push(e));

    const offer = negotiation.propose({
      fromAgent: 'agent-a',
      toAgent: 'agent-b',
      resource: 'gpu-slot',
      type: 'resource_request',
      bid: 10,
    });
    assert.strictEqual(offer.status, 'pending');
    assert.strictEqual(offer.bid, 10);

    // Recipient counters with a higher bid.
    negotiation.counter(offer.id, 'agent-b', 15);
    const countered = negotiation.getProposal(offer.id)!;
    assert.strictEqual(countered.status, 'countered');
    assert.strictEqual(countered.counterPayload, '15');

    // Then accepts.
    negotiation.accept(offer.id, 'agent-b');
    const accepted = negotiation.getProposal(offer.id)!;
    assert.strictEqual(accepted.status, 'accepted');

    // counter + accept => two resolved events in order.
    assert.strictEqual(resolved.length, 2);
    assert.strictEqual(resolved[0].status, 'countered');
    assert.strictEqual(resolved[1].status, 'accepted');
  });

  it('rejection path terminates without agreement', () => {
    const resolved: Array<{ status: string }> = [];
    eventBus.on('negotiate.resolved' as any, (e: any) => resolved.push(e));

    const offer = negotiation.propose({
      fromAgent: 'agent-a',
      toAgent: 'agent-b',
      resource: 'lock-x',
      type: 'task_handoff',
    });
    assert.strictEqual(offer.bid, 0); // default bid

    negotiation.reject(offer.id, 'agent-b');
    const rejected = negotiation.getProposal(offer.id)!;
    assert.strictEqual(rejected.status, 'rejected');

    assert.strictEqual(resolved.length, 1);
    assert.strictEqual(resolved[0].status, 'rejected');

    // A rejected proposal is no longer pending for the recipient.
    assert.deepStrictEqual(negotiation.getPendingForAgent('agent-b'), []);
  });

  it('accept/reject/counter by a non-recipient agent throws', () => {
    const offer = negotiation.propose({
      fromAgent: 'agent-a',
      toAgent: 'agent-b',
      resource: 'r',
      type: 'capability_offer',
    });

    assert.throws(() => negotiation.accept(offer.id, 'agent-x'), /not the recipient/);
    assert.throws(() => negotiation.reject(offer.id, 'agent-x'), /not the recipient/);
    assert.throws(() => negotiation.counter(offer.id, 'agent-x', 5), /not the recipient/);
    // Untouched, still pending.
    assert.strictEqual(negotiation.getProposal(offer.id)!.status, 'pending');
  });

  it('accept on a missing proposal throws', () => {
    assert.throws(() => negotiation.accept('no-proposal', 'agent-b'), /Proposal not found/);
  });

  it('getProposal lazily expires a pending proposal past its TTL', () => {
    const offer = negotiation.propose({
      fromAgent: 'agent-a',
      toAgent: 'agent-b',
      resource: 'stale',
      type: 'resource_request',
      ttlMs: -1, // already expired
    });

    const fetched = negotiation.getProposal(offer.id)!;
    assert.strictEqual(fetched.status, 'expired');
  });

  it('getPendingForAgent returns only live pending offers for the agent', () => {
    const live = negotiation.propose({
      fromAgent: 'agent-a',
      toAgent: 'agent-b',
      resource: 'live',
      type: 'resource_request',
      ttlMs: 30_000,
    });
    // For a different recipient — must not appear for agent-b.
    negotiation.propose({
      fromAgent: 'agent-a',
      toAgent: 'agent-c',
      resource: 'other',
      type: 'resource_request',
      ttlMs: 30_000,
    });
    // Expired one — excluded by expireStale().
    negotiation.propose({
      fromAgent: 'agent-a',
      toAgent: 'agent-b',
      resource: 'dead',
      type: 'resource_request',
      ttlMs: -1,
    });

    const pending = negotiation.getPendingForAgent('agent-b');
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].id, live.id);
    assert.strictEqual(pending[0].resource, 'live');
  });

  it('expireStale flips stale pending proposals to expired and returns the count', () => {
    const p = (resource: string, ttlMs: number) =>
      negotiation.propose({ fromAgent: 'a', toAgent: 'b', resource, type: 'task_handoff', ttlMs });
    p('x1', -1);
    p('x2', -1);
    const liveOffer = p('x3', 30_000);

    assert.strictEqual(negotiation.expireStale(), 2);
    assert.strictEqual(negotiation.getProposal(liveOffer.id)!.status, 'pending'); // live one survives
  });
});
