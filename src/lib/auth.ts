import "server-only";

/**
 * Single-operator mode: there is no login. Every visitor is the platform
 * operator with admin rights. Data access happens server-side with the
 * service role; protect the deployment at the hosting level if it is public
 * (e.g. Vercel Deployment Protection).
 */
export type Role = "user" | "admin";
export type SessionUser = { id: string | null; email: string; role: Role; displayName: string | null };

const OPERATOR: SessionUser = { id: null, email: "", role: "admin", displayName: "Operador" };

export async function getSessionUser(): Promise<SessionUser> {
  return OPERATOR;
}

export async function requireUser(): Promise<SessionUser> {
  return OPERATOR;
}

export async function requireAdminPage(): Promise<SessionUser> {
  return OPERATOR;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function assertUser(): Promise<SessionUser> {
  return OPERATOR;
}

export async function assertAdmin(): Promise<SessionUser> {
  return OPERATOR;
}
