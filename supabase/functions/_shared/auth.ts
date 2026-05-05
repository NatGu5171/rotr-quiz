// Caller-JWT helpers + Supabase service-role client factory.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CallerInfo {
  user_id: string;
  email: string;
  role: string | null;          // app_metadata.role
  raw_jwt: string;
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function requireAuth(req: Request): Promise<CallerInfo> {
  const auth = req.headers.get("Authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw httpError(401, "Missing bearer token");
  const jwt = m[1];

  const sb = serviceClient();
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data?.user) throw httpError(401, "Invalid token");

  return {
    user_id: data.user.id,
    email: data.user.email ?? "",
    role: (data.user.app_metadata as Record<string, unknown> | null)?.role as string ?? null,
    raw_jwt: jwt,
  };
}

export function requireGlobalAdmin(c: CallerInfo): void {
  if (c.role !== "global_admin") throw httpError(403, "Global admin only");
}

export class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}
export function httpError(status: number, msg: string): HttpError {
  return new HttpError(status, msg);
}
