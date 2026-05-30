import type { WorkspaceEventBus } from '../events/event-bus.js';

export type PatternType = 'burst' | 'sequence' | 'absence';
export type PatternAction = 'alert' | 'emit_signal' | 'trigger_workflow';

export interface BurstConfig {
  readonly eventType: string;
  readonly threshold: number;
  readonly windowMs: number;
}

export interface SequenceConfig {
  readonly events: readonly string[];
  readonly maxGapMs: number;
}

export interface AbsenceConfig {
  readonly eventType: string;
  readonly expectedWithinMs: number;
}

export interface PatternRule {
  readonly id: string;
  readonly name: string;
  readonly type: PatternType;
  readonly config: BurstConfig | SequenceConfig | AbsenceConfig;
  readonly action: PatternAction;
  readonly enabled: boolean;
}

export interface PatternMatch {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly type: PatternType;
  readonly matchedAt: number;
  readonly evidence: Record<string, unknown>;
}

export class EventProcessor {
  private readonly eventBus: WorkspaceEventBus;
  private rules: PatternRule[] = [];
  private readonly eventWindows: Map<string, number[]> = new Map();
  private readonly sequenceBuffers: Map<string, { events: string[]; timestamps: number[] }> = new Map();
  private readonly lastSeen: Map<string, number> = new Map();
  private readonly matches: PatternMatch[] = [];

  constructor(eventBus: WorkspaceEventBus) {
    this.eventBus = eventBus;
  }

  addRule(rule: PatternRule): void {
    this.rules = [...this.rules, rule];
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }

  processEvent(eventType: string, timestamp?: number): PatternMatch[] {
    const ts = timestamp ?? Date.now();
    this.lastSeen.set(eventType, ts);

    const window = this.eventWindows.get(eventType) ?? [];
    this.eventWindows.set(eventType, [...window, ts]);

    const matched: PatternMatch[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      let isMatch = false;
      let evidence: Record<string, unknown> = {};

      switch (rule.type) {
        case 'burst': {
          const burstConfig = rule.config as BurstConfig;
          if (burstConfig.eventType === eventType && this.checkBurst(burstConfig, ts)) {
            isMatch = true;
            const relevantWindow = (this.eventWindows.get(burstConfig.eventType) ?? []).filter(
              (t) => t >= ts - burstConfig.windowMs && t <= ts
            );
            evidence = { count: relevantWindow.length, windowMs: burstConfig.windowMs };
          }
          break;
        }
        case 'sequence': {
          const seqConfig = rule.config as SequenceConfig;
          if (this.checkSequence(rule.id, seqConfig, eventType, ts)) {
            isMatch = true;
            evidence = { completedSequence: seqConfig.events };
          }
          break;
        }
        case 'absence': {
          const absConfig = rule.config as AbsenceConfig;
          if (this.checkAbsence(absConfig, ts)) {
            isMatch = true;
            const lastSeenTs = this.lastSeen.get(absConfig.eventType);
            evidence = { eventType: absConfig.eventType, lastSeenAt: lastSeenTs, gapMs: lastSeenTs ? ts - lastSeenTs : null };
          }
          break;
        }
      }

      if (isMatch) {
        const match: PatternMatch = {
          ruleId: rule.id,
          ruleName: rule.name,
          type: rule.type,
          matchedAt: ts,
          evidence,
        };
        matched.push(match);
        this.matches.push(match);
        if (this.matches.length > 100) {
          this.matches.shift();
        }
      }
    }

    return matched;
  }

  private checkBurst(config: BurstConfig, timestamp: number): boolean {
    const window = this.eventWindows.get(config.eventType) ?? [];
    const windowStart = timestamp - config.windowMs;
    const relevant = window.filter((t) => t >= windowStart && t <= timestamp);
    return relevant.length >= config.threshold;
  }

  private checkSequence(ruleId: string, config: SequenceConfig, eventType: string, timestamp: number): boolean {
    let buffer = this.sequenceBuffers.get(ruleId);

    if (!buffer) {
      buffer = { events: [], timestamps: [] };
      this.sequenceBuffers.set(ruleId, buffer);
    }

    const nextIndex = buffer.events.length;
    const expectedEvent = config.events[nextIndex];

    if (eventType === expectedEvent) {
      const lastTimestamp = buffer.timestamps[buffer.timestamps.length - 1];
      const withinGap = lastTimestamp === undefined || (timestamp - lastTimestamp) <= config.maxGapMs;

      if (withinGap) {
        const updatedBuffer = {
          events: [...buffer.events, eventType],
          timestamps: [...buffer.timestamps, timestamp],
        };
        this.sequenceBuffers.set(ruleId, updatedBuffer);

        if (updatedBuffer.events.length === config.events.length) {
          this.sequenceBuffers.set(ruleId, { events: [], timestamps: [] });
          return true;
        }
        return false;
      }
    }

    if (eventType === config.events[0]) {
      this.sequenceBuffers.set(ruleId, { events: [eventType], timestamps: [timestamp] });
    }

    return false;
  }

  private checkAbsence(config: AbsenceConfig, timestamp: number): boolean {
    const lastSeenTs = this.lastSeen.get(config.eventType);
    if (lastSeenTs === undefined) return false;
    return (timestamp - lastSeenTs) > config.expectedWithinMs;
  }

  getActiveRules(): PatternRule[] {
    return this.rules;
  }

  getMatches(since?: number): PatternMatch[] {
    if (since === undefined) return [...this.matches];
    return this.matches.filter((m) => m.matchedAt >= since);
  }

  pruneWindows(maxAgeMs: number = 300000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [eventType, timestamps] of this.eventWindows) {
      const pruned = timestamps.filter((t) => t >= cutoff);
      if (pruned.length === 0) {
        this.eventWindows.delete(eventType);
      } else {
        this.eventWindows.set(eventType, pruned);
      }
    }
  }
}
