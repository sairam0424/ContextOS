import { Search, X } from 'lucide-react';

interface Props {
  value: string;
  onChange: (q: string) => void;
}

const GraphFilterBar: React.FC<Props> = ({ value, onChange }) => (
  <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
    <div className="glass flex items-center gap-2 px-3 py-2 w-72">
      <Search size={14} className="text-primary opacity-60 flex-shrink-0" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Filter graph nodes..."
        className="bg-transparent text-[12px] text-white placeholder-white/30 outline-none w-full font-mono"
      />
      {value && (
        <button onClick={() => onChange('')} className="text-white/40 hover:text-white transition-colors flex-shrink-0">
          <X size={12} />
        </button>
      )}
    </div>
  </div>
);

export default GraphFilterBar;
