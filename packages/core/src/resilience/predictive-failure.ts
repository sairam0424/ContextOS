import type { WorkspaceEventBus } from '../events/event-bus.js';

export type PredictiveState = 'healthy' | 'degrading' | 'failing' | 'recovered';

export interface CUSUMResult {
  readonly service: string;
  readonly state: PredictiveState;
  readonly cumulativeSum: number;
  readonly threshold: number;
  readonly changePointDetected: boolean;
  readonly detectedAt: number | null;
}

export interface ProactiveAction {
  readonly service: string;
  readonly action: 'reduce_batch' | 'switch_provider' | 'pause_queue' | 'alert_user';
  readonly reason: string;
  readonly triggeredAt: number;
}

interface ServiceState {
  readonly values: readonly number[];
  readonly cusumPos: number;
  readonly cusumNeg: number;
  readonly mean: number;
  readonly detectedAt: number | null;
}

const DEFAULT_THRESHOLD = 5.0;
const DEFAULT_DRIFT = 1.0;
const EMA_ALPHA = 0.05;

function updateMean(currentMean: number, value: number): number {
  return currentMean + EMA_ALPHA * (value - currentMean);
}

function determineState(cusumPos: number, threshold: number): PredictiveState {
  if (cusumPos > threshold * 2) return 'failing';
  if (cusumPos > threshold) return 'degrading';
  return 'healthy';
}

export class PredictiveFailureService {
  private readonly eventBus: WorkspaceEventBus;
  private readonly states: Map<string, ServiceState>;
  private readonly threshold: number;
  private readonly drift: number;

  constructor(eventBus: WorkspaceEventBus, config?: { threshold?: number; drift?: number }) {
    this.eventBus = eventBus;
    this.states = new Map();
    this.threshold = config?.threshold ?? DEFAULT_THRESHOLD;
    this.drift = config?.drift ?? DEFAULT_DRIFT;
  }

  recordMetric(service: string, value: number): CUSUMResult {
    const previous = this.states.get(service) ?? {
      values: [],
      cusumPos: 0,
      cusumNeg: 0,
      mean: value,
      detectedAt: null,
    };

    const newMean = previous.values.length === 0
      ? value
      : updateMean(previous.mean, value);

    const cusumPos = Math.max(0, previous.cusumPos + (value - newMean - this.drift));
    const cusumNeg = Math.max(0, previous.cusumNeg + (newMean - this.drift - value));

    const changePointDetected = cusumPos > this.threshold || cusumNeg > this.threshold;

    const detectedAt = changePointDetected && previous.detectedAt === null
      ? Date.now()
      : previous.detectedAt;

    const newState: ServiceState = {
      values: [...previous.values, value],
      cusumPos,
      cusumNeg,
      mean: newMean,
      detectedAt,
    };

    this.states.set(service, newState);

    const state = determineState(cusumPos, this.threshold);

    const previousState = determineState(previous.cusumPos, this.threshold);
    if (state !== previousState && (state === 'degrading' || state === 'failing')) {
      this.emitStateTransition(service, previousState, state);
    }

    return {
      service,
      state,
      cumulativeSum: cusumPos,
      threshold: this.threshold,
      changePointDetected,
      detectedAt,
    };
  }

  getState(service: string): CUSUMResult {
    const state = this.states.get(service);

    if (!state) {
      return {
        service,
        state: 'healthy',
        cumulativeSum: 0,
        threshold: this.threshold,
        changePointDetected: false,
        detectedAt: null,
      };
    }

    const predictiveState = determineState(state.cusumPos, this.threshold);
    const changePointDetected = state.cusumPos > this.threshold || state.cusumNeg > this.threshold;

    return {
      service,
      state: predictiveState,
      cumulativeSum: state.cusumPos,
      threshold: this.threshold,
      changePointDetected,
      detectedAt: state.detectedAt,
    };
  }

  getAllStates(): CUSUMResult[] {
    return Array.from(this.states.keys()).map(service => this.getState(service));
  }

  getProactiveActions(service?: string): ProactiveAction[] {
    const services = service ? [service] : Array.from(this.states.keys());
    const actions: ProactiveAction[] = [];
    const now = Date.now();

    for (const svc of services) {
      const result = this.getState(svc);

      if (result.state === 'degrading') {
        actions.push({
          service: svc,
          action: 'reduce_batch',
          reason: `CUSUM drift detected (${result.cumulativeSum.toFixed(2)} > ${this.threshold}); reducing load to prevent failure`,
          triggeredAt: now,
        });
        actions.push({
          service: svc,
          action: 'switch_provider',
          reason: `Service ${svc} showing degradation pattern; failover recommended`,
          triggeredAt: now,
        });
      }

      if (result.state === 'failing') {
        actions.push({
          service: svc,
          action: 'pause_queue',
          reason: `Service ${svc} in failure state (CUSUM ${result.cumulativeSum.toFixed(2)} > ${this.threshold * 2}); pausing to prevent cascade`,
          triggeredAt: now,
        });
        actions.push({
          service: svc,
          action: 'alert_user',
          reason: `Service ${svc} has exceeded double threshold; manual intervention may be required`,
          triggeredAt: now,
        });
      }
    }

    return actions;
  }

  reset(service: string): void {
    this.states.delete(service);
  }

  getTrackedServices(): string[] {
    return Array.from(this.states.keys());
  }

  private emitStateTransition(
    service: string,
    previousState: PredictiveState,
    newState: PredictiveState
  ): void {
    const event = {
      type: 'system.predictive_failure',
      service,
      previousState,
      newState,
      actions: this.getProactiveActions(service),
    } as unknown;
    this.eventBus.emit(event as any);
  }
}
