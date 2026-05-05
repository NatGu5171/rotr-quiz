import { preflight, json } from "../_shared/cors.ts";
import { requireAuth, serviceClient, HttpError } from "../_shared/auth.ts";

interface Body {
  user_ids: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  try {
    const caller = await requireAuth(req);
    const sb = serviceClient();

    const isGlobal = caller.role === "global_admin";
    if (!isGlobal) {
      const { count } = await sb
        .from("admin_grants")
        .select("*", { count: "exact", head: true })
        .eq("user_id", caller.user_id)
        .eq("scope_type", "group");
      if (!count || count === 0) return json({ error: "Forbidden" }, 403);
    }

    const { user_ids } = (await req.json()) as Body;
    if (!Array.isArray(user_ids)) return json({ error: "Missing user_ids" }, 400);

    const ids = [...new Set(user_ids.map((id) => String(id).trim()).filter(Boolean))];
    if (ids.length > 100) return json({ error: "Too many user_ids; max 100" }, 400);
    if (ids.some((id) => !UUID_RE.test(id))) return json({ error: "Invalid user_id" }, 400);

    const users: { id: string; email: string | null }[] = [];
    for (const id of ids) {
      const { data, error } = await sb.auth.admin.getUserById(id);
      if (error || !data?.user) continue;
      users.push({ id: data.user.id, email: data.user.email ?? null });
    }

    return json({ users });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: (e as Error).message }, 500);
  }
});
