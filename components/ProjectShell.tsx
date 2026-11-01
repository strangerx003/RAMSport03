"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, type SidebarItem } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import type { SessionUser } from "@/lib/session";

export function ProjectShell({
  children,
  projectId,
  projectName,
  projectCode,
  rev,
  roleLabel,
  user,
  items,
}: {
  children: ReactNode;
  projectId: string;
  projectName: string;
  projectCode: string | null;
  rev: number;
  roleLabel: string;
  user: SessionUser;
  items: SidebarItem[];
}) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname() || "";

  // RBD and FTA are canvas-first: they render full-bleed to the window.
  const isDiagramModule = /\/(rbd|fta)$/.test(pathname);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Escape closes it, and the page behind the drawer does not scroll.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [navOpen]);

  // Going back to a desktop width should never leave a stale open drawer.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 901px)");
    const onChange = () => {
      if (desktop.matches) setNavOpen(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  return (
    <div className={`shell${navOpen ? " nav-open" : ""}`}>
      <button
        type="button"
        className="nav-scrim"
        aria-label="Close navigation"
        tabIndex={navOpen ? 0 : -1}
        onClick={() => setNavOpen(false)}
      />
      <Sidebar
        projectName={projectName}
        projectCode={projectCode}
        rev={rev}
        items={items}
        onNavigate={() => setNavOpen(false)}
      />
      <div className="main">
        <Topbar
          user={user}
          projectName={projectName}
          projectId={projectId}
          rev={rev}
          roleLabel={roleLabel}
          menuOpen={navOpen}
          onMenu={() => setNavOpen((open) => !open)}
        />
        <div className={`content${isDiagramModule ? " content-diagram" : ""}`}>{children}</div>
      </div>
    </div>
  );
}
