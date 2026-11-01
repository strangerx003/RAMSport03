export default function ModuleLoading() {
  return (
    <div className="module-loading" aria-busy="true" aria-live="polite">
      <div className="skeleton skeleton-eyebrow" />
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton-panel">
        <div className="skeleton skeleton-panel-head" />
        <div className="skeleton-panel-body">
          <div className="skeleton skeleton-side" />
          <div className="skeleton skeleton-canvas" />
        </div>
      </div>
    </div>
  );
}
