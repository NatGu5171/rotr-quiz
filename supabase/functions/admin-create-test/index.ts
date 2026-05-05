import { preflight, json } from "../_shared/cors.ts";
import { requireAuth, requireGlobalAdmin, serviceClient, HttpError } from "../_shared/auth.ts";
import { hashPassword } from "../_shared/password.ts";

interface Body {
  name: string;
  password: string;
  scope: string[];
  rules: string[];
  question_ids: number[];
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  try {
    const caller = await requireAuth(req);
    requireGlobalAdmin(caller);

    const body = (await req.json()) as Body;
    if (!body?.name?.trim() || !body?.password || !Array.isArray(body.question_ids) || body.question_ids.length === 0) {
      return json({ error: "Missing name, password, or question_ids" }, 400);
    }

    const password_hash = await hashPassword(body.password);
    const sb = serviceClient();
    const { data, error } = await sb.from("tests").insert({
      name:          body.name.trim(),
      password_hash,
      scope:         body.scope ?? [],
      rules:         body.rules ?? [],
      question_ids:  body.question_ids,
      created_by:    caller.user_id,
    }).select("id").single();

    if (error) {
      if (error.code === "23505") return json({ error: "A test with this name already exists" }, 409);
      return json({ error: error.message }, 500);
    }
    return json({ id: data.id });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: (e as Error).message }, 500);
  }
});
