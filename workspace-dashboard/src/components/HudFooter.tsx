interface Props {
  ticker: string;
}

const HudFooter: React.FC<Props> = ({ ticker }) => (
  <footer className="grid-in-footer flex justify-between items-center pointer-events-none">
    <div className="glass py-2 px-4 pointer-events-auto flex items-center gap-4">
      <div className="w-2 h-2 rounded-full bg-primary shadow-glow animate-pulse" />
      <div className="font-display text-[10px] text-primary tracking-[1px] w-[300px] truncate">
        {ticker}
      </div>
      <div className="font-display text-xs">
        {new Date().toLocaleTimeString()}
      </div>
    </div>
    <div className="glass py-2 px-4 pointer-events-auto font-display text-[10px] tracking-[1px]">
      DECK: <span className="text-primary">V2.0.0-NEXUS</span>
    </div>
  </footer>
);

export default HudFooter;
