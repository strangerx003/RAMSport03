"use client";

import Link from "next/link";
import { signOutAction } from "@/lib/actions";
import type { SessionUser } from "@/lib/session";

export function Topbar({
  user,
  projectName,
  projectId,
  rev,
  roleLabel,
  menuOpen,
  onMenu,
}: {
  user: SessionUser;
  projectName: string;
  projectId: string;
  rev: number;
  roleLabel: string;
  menuOpen: boolean;
  onMenu: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="menu-toggle"
          type="button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-controls="project-nav"
          aria-expanded={menuOpen}
          onClick={onMenu}
        >
          <span className={`menu-icon${menuOpen ? " open" : ""}`} aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </button>
        <span className="crumb">
          <Link href="/projects">Projects</Link> /{" "}
          <Link href={`/w/${projectId}/pbs`}>{projectName}</Link>
        </span>
        <span className="stamp" title="Every save bumps the project revision">
          rev {rev}
        </span>
      </div>
      <div className="topbar-right">
        <span className="stamp stamp-accent" title="Your role on this project">
          {roleLabel}
        </span>
        <span className="topbar-user small muted">
          <span style={{ color: "var(--ink)", fontWeight: 600 }}>{user.name || user.email}</span>
          <span className="tiny">{user.company_name ?? ""}</span>
        </span>
        <form action={signOutAction}>
          <button className="btn btn-sm btn-ghost" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
