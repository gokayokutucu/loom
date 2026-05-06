import { ChevronsDown, ChevronsUp, Focus, Minus, Plus, Scan } from "lucide-react";

export interface GraphControlsProps {
  onFirst: () => void;
  onLast: () => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function GraphControls({
  onFirst,
  onLast,
  onFit,
  onZoomIn,
  onZoomOut,
}: GraphControlsProps) {
  return (
    <div className="loom-graph-controls" aria-label="Graph controls">
      <button type="button" onClick={onFirst} aria-label="Go to first node" title="First node">
        <ChevronsUp size={15} />
      </button>
      <button type="button" onClick={onLast} aria-label="Go to last node" title="Last node">
        <ChevronsDown size={15} />
      </button>
      <button type="button" onClick={onFit} aria-label="Fit graph" title="Fit graph">
        <Scan size={15} />
      </button>
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
        <Plus size={15} />
      </button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">
        <Minus size={15} />
      </button>
      <button type="button" onClick={onFit} aria-label="Reset view" title="Reset view">
        <Focus size={15} />
      </button>
    </div>
  );
}
