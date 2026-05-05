import { preflight, json } from "../_shared/cors.ts";
import { requireAuth, serviceClient, HttpError } from "../_shared/auth.ts";

interface Body { email: string }

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  try {
    const caller = await requireAuth(req);

    // Caller must be at least a group admin (RLS check is done at write-time
    // anyway; we just refuse to expose user_ids to non-admins).
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

    const { email } = (await req.json()) as Body;
    if (!email) return json({ error: "Missing email" }, 400);

    // listUsers is paginated; we filter client-side. For small instances this is fine;
    // for larger ones swap for the GoTrue admin search endpoint.
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
      if (error) return json({ error: error.message }, 500);
      const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email.toLowerCase());
      if (u) return json({ id: u.id, email: u.email });
      if (data.users.length < perPage) break;
      page++;
    }
    return json({ error: "User not found" }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: (e as Error).message }, 500);
  }
});
