import type { WorkspaceEventBus } from '../events/event-bus.js';

export type HealthState = 'healthy' | 'degrading' | 'failing';

export interface HealthPrediction {
  readonly service: string;
  readonly currentState: HealthState;
  readonly predictedState: HealthState;
  readonly confidence: number;
  readonly trend: number;
  readonly recommendation: string;
  readonly lastUpdated: number;
}

export interface ServiceSignal {
  readonly service: string;
  readonly latencyMs: number;
  readonly isError: boolean;
  readonly timestamp: number;
}

interface ServiceData {
  readonly latencies: number[];
  readonly errors: number[];
  readonly timestamps: number[];
}

interface EwmaState {
  ewmaLatency: number;
  ewmaErrorRate: number;
}

export class PredictiveHealthMonitor {
  private readonly eventBus: WorkspaceEventBus;
  private readonly serviceData: Map<string, ServiceData> = new Map();
  private readonly ewmaState: Map<string, EwmaState> = new Map();
  private readonly alpha = 0.2;
  private static readonly MAX_WINDOW = 100;

  constructor(eventBus: WorkspaceEventBus) {
    this.eventBus = eventBus;
  }

  recordSignal(signal: ServiceSignal): void {
    const existing = this.serviceData.get(signal.service) ?? { latencies: [], errors: [], timestamps: [] };

    const latencies = [...existing.latencies, signal.latencyMs].slice(-PredictiveHealthMonitor.MAX_WINDOW);
    const errors = [...existing.errors, signal.isError ? 1 : 0].slice(-PredictiveHealthMonitor.MAX_WINDOW);
    const timestamps = [...existing.timestamps, signal.timestamp].slice(-PredictiveHealthMonitor.MAX_WINDOW);

    this.serviceData.set(signal.service, { latencies, errors, timestamps });

    const currentEwma = this.ewmaState.get(signal.service) ?? { ewmaLatency: signal.latencyMs, ewmaErrorRate: 0 };
    const errorValue = signal.isError ? 1 : 0;

    const updatedEwma: EwmaState = {
      ewmaLatency: this.alpha * signal.latencyMs + (1 - this.alpha) * currentEwma.ewmaLatency,
      ewmaErrorRate: this.alpha * errorValue + (1 - this.alpha) * currentEwma.ewmaErrorRate,
    };

    this.ewmaState.set(signal.service, updatedEwma);

    if (updatedEwma.ewmaErrorRate > 0.5) {
      this.eventBus.emit({
        type: 'health.degradation' as any,
        payload: { service: signal.service, errorRate: updatedEwma.ewmaErrorRate },
        timestamp: signal.timestamp,
        source: 'predictive-health-monitor',
      } as any);
    }
  }

  predict(service: string): HealthPrediction | null {
    const data = this.serviceData.get(service);
    const ewma = this.ewmaState.get(service);

    if (!data || !ewma) return null;

    const recentLatencies = data.latencies.slice(-20);
    const trend = this.linearSlope(recentLatencies);
    const errorRate = ewma.ewmaErrorRate;

    const currentState = this.determineState(errorRate, trend);
    const predictedState = this.predictNextState(currentState, trend);
    const confidence = this.computeConfidence(recentLatencies);
    const recommendation = this.generateRecommendation(currentState, predictedState);

    return {
      service,
      currentState,
      predictedState,
      confidence,
      trend,
      recommendation,
      lastUpdated: data.timestamps[data.timestamps.length - 1] ?? Date.now(),
    };
  }

  predictAll(): HealthPrediction[] {
    const predictions: HealthPrediction[] = [];
    for (const service of this.serviceData.keys()) {
      const prediction = this.predict(service);
      if (prediction) {
        predictions.push(prediction);
      }
    }
    return predictions;
  }

  getServiceNames(): string[] {
    return [...this.serviceData.keys()];
  }

  reset(service: string): void {
    this.serviceData.delete(service);
    this.ewmaState.delete(service);
  }

  private determineState(errorRate: number, trend: number): HealthState {
    if (errorRate >= 0.5 || trend >= 2.0) return 'failing';
    if (errorRate >= 0.1 || (trend >= 0.5 && trend < 2.0)) return 'degrading';
    return 'healthy';
  }

  private predictNextState(currentState: HealthState, trend: number): HealthState {
    if (currentState === 'degrading' && trend > 0) return 'failing';
    return currentState;
  }

  private computeConfidence(values: number[]): number {
    if (values.length < 2) return 0.5;

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;

    const normalizedVariance = variance / (mean * mean + 1);
    const confidence = 1 / (1 + normalizedVariance);

    return Math.min(confidence, 1.0);
  }

  private generateRecommendation(currentState: HealthState, predictedState: HealthState): string {
    if (predictedState === 'failing' || currentState === 'failing') return 'Pause queue';
    if (currentState === 'degrading') return 'Reduce batch size';
    if (predictedState === 'degrading') return 'Switch provider';
    return 'No action needed';
  }

  private linearSlope(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumXX += i * i;
    }
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }
}
