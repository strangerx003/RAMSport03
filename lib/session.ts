import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { createSessionToken, readSessionToken } from "@/lib/auth";

export const SESSION_COOKIE = "relia_session";
export const PROJECT_COOKIE = "relia_project";

export type SessionUser = {
  id: string;
  company_id: string;
  email: string;
  name: string;
  role: "super_admin" | "company_admin" | "employee" | "reviewer";
  company_name?: string;
};

export type Access = { read: boolean; write: boolean };

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const userId = readSessionToken(token);
  if (!userId) return null;
  const db = getDb();
  const user = db
    .prepare(
      `SELECT u.*, c.name AS company_name FROM users u
         JOIN companies c ON c.id = u.company_id
        WHERE u.id = ?`,
    )
    .get(userId) as any;
  if (!user) return null;
  return user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function setSession(userId: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Remember the project the user opened. Section URLs are project-free, so
 * this cookie is the single source of the active project between requests.
 */
export async function setActiveProject(projectId: string) {
  const store = await cookies();
  store.set(PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
    secure: process.env.NODE_ENV === "production",
  });
}

export type ProjectContext = {
  user: SessionUser;
  db: ReturnType<typeof getDb>;
  project: any;
  entitlements: Set<string>;
  grants: Record<string, string>;
  role: string;
  member: any;
  access: (module: string) => Access;
  requireRead: (module: string) => void;
  requireWrite: (module: string) => void;
};

export async function buildProjectContext(user: SessionUser, project: any): Promise<ProjectContext> {
  const db = getDb();
  const projectId = project.id;

  const entitlements = new Set(
    (db
      .prepare("SELECT module_key FROM module_entitlements WHERE project_id = ? AND enabled = 1")
      .all(projectId) as any[]).map((r) => r.module_key),
  );

  const member = db
    .prepare("SELECT * FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, user.id) as any;

  let grants: Record<string, string> = {};
  try {
    grants = member?.module_grants ? JSON.parse(member.module_grants) : {};
  } catch {
    grants = {};
  }

  const role = member?.role || user.role;
  const isAdmin = role === "company_admin" || role === "super_admin";

  const access = (module: string): Access => {
    if (!entitlements.has(module)) return { read: false, write: false };
    if (isAdmin) return { read: true, write: true };
    if (role === "reviewer") return { read: true, write: false };
    const grant = grants[module];
    if (grant === "write") return { read: true, write: true };
    if (grant === "read") return { read: true, write: false };
    return { read: false, write: false };
  };

  const requireRead = (module: string) => {
    if (!access(module).read) throw new Error(`You do not have access to the ${module.toUpperCase()} module.`);
  };
  const requireWrite = (module: string) => {
    if (!access(module).write) throw new Error(`You have read-only access to the ${module.toUpperCase()} module.`);
  };

  return { user, db, project, entitlements, grants, role, member, access, requireRead, requireWrite };
}

export async function requireProject(projectId: string): Promise<ProjectContext> {
  const user = await requireUser();
  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project || project.company_id !== user.company_id) notFound();
  return buildProjectContext(user, project);
}

/**
 * The section URLs are project-free (/pbs, /rbd, /data-register …), so the
 * workspace context comes from the recalled project cookie — falling back to
 * the company's first project when nothing is selected yet.
 */
export async function requireActiveProject(): Promise<ProjectContext> {
  const user = await requireUser();
  const db = getDb();
  const store = await cookies();
  const wanted = store.get(PROJECT_COOKIE)?.value;

  const projects = db
    .prepare("SELECT * FROM projects WHERE company_id = ? ORDER BY created_at")
    .all(user.company_id) as any[];
  const project = projects.find((item) => item.id === wanted) ?? projects[0];
  if (!project) redirect("/projects");
  return buildProjectContext(user, project);
}

export function isAdminRole(role: string): boolean {
  return role === "company_admin" || role === "super_admin";
}
