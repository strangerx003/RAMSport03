/**
 * Shared types for the RBD / FTA diagram workbench.
 * The editor is a client component; these shapes are also the persisted
 * JSON document stored per project and per mode in `diagram_workspaces`.
 */

export type WorkspaceMode = "rbd" | "fta";

export type DiagramNode = {
  id: number;
  x: number;
  y: number;
  type: string;
  title: string;
  subtitle: string;
  assetId?: string;
  groupId?: string;
  failureRate?: number;
  mttr?: number;
  mission?: number;
  /** Voting gates only: how many inputs must occur. */
  gateK?: number;
};

export type DiagramEdge = {
  from: number;
  to: number;
  style: "straight" | "elbow";
  waypoint?: { x: number; y: number };
  fromSide?: "left" | "right" | "top" | "bottom";
  toSide?: "left" | "right" | "top" | "bottom";
};

export type RbdGroup = {
  id: string;
  tag: string;
  name: string;
  failureRate: number;
  mtbf: number;
  mttr: number;
  availability: number;
  configuration: string;
  paths: number;
  memberCount: number;
  createdAt: string;
  formulaVersion: "rbd-sheet-v1";
};

export type WorkspaceState = {
  version: 1;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: RbdGroup[];
  missionHours: number;
};

/** A PBS component projected into the library card / block shape. */
export type WorkspaceComponent = {
  id: string;
  tag: string;
  description: string;
  system: string;
  lambda: number;
  mttr: number;
  mission: number;
  quantity: number;
};

export function emptyWorkspace(missionHours: number): WorkspaceState {
  return { version: 1, nodes: [], edges: [], groups: [], missionHours };
}

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    (candidate.groups === undefined || Array.isArray(candidate.groups))
  );
}
