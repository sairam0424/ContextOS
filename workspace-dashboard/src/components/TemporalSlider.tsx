import { useCallback } from 'react';

interface TemporalSliderProps {
  minTimestamp: number;
  maxTimestamp: number;
  onTimeTravel: (timestamp: number) => void;
  isActive: boolean;
  onToggle: () => void;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

export default function TemporalSlider({
  minTimestamp,
  maxTimestamp,
  onTimeTravel,
  isActive,
  onToggle,
}: TemporalSliderProps) {
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onTimeTravel(Number(e.target.value));
    },
    [onTimeTravel],
  );

  return (
    <div className="w-full backdrop-blur-md bg-white/5 border border-white/10 rounded-lg px-4 py-2 flex items-center gap-4">
      <button
        onClick={onToggle}
        className={`px-3 py-1 rounded text-xs font-mono font-semibold tracking-wider transition-colors ${
          isActive
            ? 'bg-cyan-400/20 text-cyan-400 border border-cyan-400/50'
            : 'bg-white/5 text-white/50 border border-white/10 hover:text-white/70'
        }`}
      >
        TEMPORAL
      </button>

      {isActive && (
        <>
          <input
            type="range"
            min={minTimestamp}
            max={maxTimestamp}
            defaultValue={maxTimestamp}
            onChange={handleSliderChange}
            className="flex-1 h-1 accent-cyan-400 cursor-pointer"
          />

          <span className="text-cyan-400 text-xs font-mono whitespace-nowrap">
            {formatTimestamp(maxTimestamp)}
          </span>

          <button
            onClick={onToggle}
            className="px-2 py-1 rounded text-xs font-mono font-semibold bg-cyan-400/10 text-cyan-400 border border-cyan-400/30 hover:bg-cyan-400/20 transition-colors"
          >
            LIVE
          </button>
        </>
      )}
    </div>
  );
}
