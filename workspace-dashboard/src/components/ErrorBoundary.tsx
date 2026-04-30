import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[Aether] Spatial engine error:', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex items-center justify-center h-full">
          <div className="glass p-8 text-center max-w-sm">
            <div className="text-red-400 text-xs uppercase tracking-[2px] font-display mb-3">
              Spatial Engine Offline
            </div>
            <p className="text-[11px] text-white/40">
              The 3D renderer encountered an error. Reload to restore.
            </p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="mt-4 px-4 py-2 text-[10px] uppercase tracking-wider glass hover:bg-white/5 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
