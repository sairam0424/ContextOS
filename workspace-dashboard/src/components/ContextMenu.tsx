import { useEffect, useRef } from 'react';
import { Copy, Lock, Search, Archive, Tag, Code, Zap } from 'lucide-react';
import type { NodeData } from '../types.js';

interface Action {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  node: NodeData;
  x: number;
  y: number;
  onClose: () => void;
  onCopyPath: (id: string) => void;
  onAcquireLock: (id: string) => void;
  onFilterToNode: (id: string) => void;
  onPulseNode: (id: string) => void;
}

const ContextMenu: React.FC<Props> = ({ node, x, y, onClose, onCopyPath, onAcquireLock, onFilterToNode, onPulseNode }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Build action list based on node type
  const actions: Action[] = [
    {
      label: 'Copy Path',
      icon: <Copy size={12} />,
      onClick: () => { onCopyPath(node.id); onClose(); },
    },
    {
      label: 'Filter to Node',
      icon: <Search size={12} />,
      onClick: () => { onFilterToNode(node.id); onClose(); },
    },
    {
      label: 'Re-embed (Pulse)',
      icon: <Zap size={12} />,
      onClick: () => { onPulseNode(node.id); onClose(); },
    },
  ];

  if (node.type === 'document') {
    actions.push({
      label: 'Acquire Lock',
      icon: <Lock size={12} />,
      onClick: () => { onAcquireLock(node.id); onClose(); },
    });
  }

  if (node.type === 'tag') {
    actions.push({
      label: 'Copy Tag',
      icon: <Tag size={12} />,
      onClick: () => { navigator.clipboard.writeText(node.label); onClose(); },
    });
  }

  if (node.type === 'symbol') {
    actions.push({
      label: 'Copy Signature',
      icon: <Code size={12} />,
      onClick: () => {
        navigator.clipboard.writeText(node.metadata?.signature ?? node.label);
        onClose();
      },
    });
  }

  if (node.type === 'mission') {
    actions.push({
      label: 'Archive Mission',
      icon: <Archive size={12} />,
      onClick: () => onClose(),
      danger: true,
    });
  }

  // Clamp to viewport so menu never renders off-screen
  const menuWidth = 180;
  const menuHeight = actions.length * 36 + 32;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 glass py-1 min-w-[180px] shadow-lg"
      style={{ top: clampedY, left: clampedX }}
    >
      <div className="px-3 py-2 border-b border-white/10 mb-1">
        <div className="text-[9px] uppercase tracking-wider text-primary/60 font-display">{node.type}</div>
        <div className="text-[11px] text-white truncate max-w-[160px]">{node.label}</div>
      </div>
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={action.onClick}
          className={`w-full px-3 py-2 text-[11px] flex items-center gap-2 hover:bg-white/10 transition-colors text-left ${action.danger ? 'text-red-400 hover:text-red-300' : 'text-white/80 hover:text-white'}`}
        >
          <span className="opacity-60">{action.icon}</span>
          {action.label}
        </button>
      ))}
    </div>
  );
};

export default ContextMenu;
