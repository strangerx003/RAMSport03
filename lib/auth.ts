import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.SESSION_SECRET || "relialedger-local-development-secret";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  return createHash("sha256").update(`relialedger::${password}`).digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  const candidate = Buffer.from(hashPassword(password));
  const expected = Buffer.from(hash || "");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, issued] = payload.split(".");
  const issuedAt = Number(issued);
  if (!userId || !Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > MAX_AGE_MS) return null;
  return userId;
}
