"use client";

import nextDynamic from "next/dynamic";

/**
 * The diagram workbench is a large interactive canvas: server-rendering the
 * full SVG and hydrating every node again doubles the first-paint work on slow
 * devices. This wrapper loads it browser-only and shows the canvas skeleton in
 * the meantime — the page itself still streams from the server instantly.
 */
const DiagramWorkbench = nextDynamic(() => import("./DiagramWorkbench"), {
  ssr: false,
  loading: () => (
    <div className="dwb dwb-loading" aria-busy="true" aria-live="polite">
      <div className="dwb-toolbar" />
      <div className="skeleton-panel-body">
        <div className="skeleton skeleton-side" />
        <div className="skeleton skeleton-canvas" />
      </div>
    </div>
  ),
});

export default DiagramWorkbench;
