import { Info, X, Copy, Zap, BrainCircuit } from 'lucide-react';
import type { NodeData } from '../types.js';

interface Props {
  selectedNode: NodeData | null;
  onClose: () => void;
  onCopyPath: (path: string) => void;
  onPulseNode: (id: string) => void;
  onAcquireLock: (id: string) => void;
}

const NodeInspector: React.FC<Props> = ({ selectedNode, onClose, onCopyPath, onPulseNode, onAcquireLock }) => (
  <section className={`grid-in-inspector glass p-5 pointer-events-auto transition-transform duration-500 ${selectedNode ? 'translate-x-0' : 'translate-x-[120%]'}`}>
    <div className="flex justify-between items-start mb-5">
      <div className="font-display text-[11px] uppercase text-primary tracking-[2px] flex items-center gap-2">
        <Info size={14} /> Node Inspector
      </div>
      <button onClick={onClose} className="text-text-dim hover:text-white transition-colors cursor-pointer">
        <X size={16} />
      </button>
    </div>

    {selectedNode ? (
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-primary font-display text-lg mb-1">{selectedNode.label}</div>
          <div className="text-[11px] opacity-50 font-mono break-all">{selectedNode.id}</div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="font-display text-[9px] uppercase text-primary tracking-[2px] opacity-60">Intelligence Metadata</div>
          <div className="glass bg-black/20 p-3 text-[12px] leading-relaxed">
            {selectedNode.metadata?.excerpt && (
              <p className="text-secondary/70 leading-relaxed italic mb-4">
                "{selectedNode.metadata.excerpt}"
              </p>
            )}
            {selectedNode.type === 'symbol' && (
              <div className="space-y-4">
                <div className="p-3 bg-white/5 rounded border border-white/10">
                  <div className="text-[10px] uppercase tracking-wider text-secondary/50 mb-1">Signature</div>
                  <code className="text-xs text-secondary/90 break-all">{selectedNode.metadata?.signature}</code>
                </div>
                <div className="flex items-center gap-2 text-xs text-secondary/60">
                  <span className="px-2 py-0.5 bg-primary/20 text-primary rounded ring-1 ring-primary/30 uppercase text-[9px]">
                    {selectedNode.metadata?.symbolType}
                  </span>
                  <span>L{selectedNode.metadata?.line} in {selectedNode.metadata?.path?.split('/').pop()}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="font-display text-[9px] uppercase text-primary tracking-[2px] opacity-60 mb-3">Entity Classification</div>
          <div className="flex gap-2 flex-wrap">
            <span className="px-3 py-1 border border-primary text-primary text-[10px] rounded-full">Type: {selectedNode.type}</span>
            <span className={`px-3 py-1 border text-[10px] rounded-full ${
              selectedNode.metadata?.intelligenceStatus === 'ready'
                ? 'border-secondary text-secondary'
                : selectedNode.metadata?.intelligenceStatus === 'processing'
                ? 'border-primary text-primary animate-pulse'
                : 'border-white/20 text-white/50'
            }`}>
              Backbone: {selectedNode.metadata?.intelligenceStatus || 'pending'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <button
            onClick={() => onCopyPath(selectedNode.id)}
            className="glass p-3 text-[10px] uppercase flex items-center justify-center gap-2 hover:bg-white/5 transition-colors border-none"
          >
            <Copy size={12} /> Copy
          </button>
          <button
            onClick={() => onPulseNode(selectedNode.id)}
            className="glass p-3 text-[10px] uppercase flex items-center justify-center gap-2 hover:bg-primary/10 transition-colors border-none text-primary"
          >
            <Zap size={12} /> Pulse
          </button>
        </div>

        {selectedNode.type === 'document' && (
          <div className="mt-4">
            <div className="font-display text-[9px] uppercase text-primary tracking-[2px] opacity-60 mb-3">Nexus Actions</div>
            <button
              className="w-full text-[10px] p-4 glass bg-primary/5 hover:bg-primary/10 text-primary border-primary/20 flex items-center justify-between group transition-all"
              onClick={() => onAcquireLock(selectedNode.id)}
            >
              <span className="font-display tracking-[1px]">ACQUIRE CONCURRENCY LOCK</span>
              <BrainCircuit size={14} className="group-hover:rotate-12 transition-transform" />
            </button>
          </div>
        )}
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center py-10 opacity-40 italic">
        <Info size={32} className="mb-4" />
        <p className="text-xs">Select an entity to reveal its spatial soul</p>
      </div>
    )}
  </section>
);

export default NodeInspector;
