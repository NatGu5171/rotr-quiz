import { preflight, json } from "../_shared/cors.ts";
import { requireAuth, serviceClient, HttpError } from "../_shared/auth.ts";
import { verifyPassword } from "../_shared/password.ts";
import { signJwt } from "../_shared/jwt.ts";
import { loadQuestions, stripAnswer, shuffle } from "../_shared/questions.ts";

interface Body {
  test_id: string;
  password: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  try {
    const caller = await requireAuth(req);
    const { test_id, password } = (await req.json()) as Body;
    if (!test_id || typeof password !== "string") {
      return json({ error: "Missing test_id or password" }, 400);
    }

    const sb = serviceClient();

    // Single-attempt gate (pre-flight)
    const { data: existing } = await sb
      .from("test_results")
      .select("id")
      .eq("test_id", test_id)
      .eq("user_id", caller.user_id)
      .maybeSingle();
    if (existing) {
      return json({ error: "You have already taken this test." }, 409);
    }

    const { data: test, error: tErr } = await sb
      .from("tests")
      .select("id, name, password_hash, question_ids")
      .eq("id", test_id)
      .single();
    if (tErr || !test) return json({ error: "Test not found" }, 404);

    const ok = await verifyPassword(password, test.password_hash);
    if (!ok) return json({ error: "Invalid password" }, 401);

    const bank = await loadQuestions();
    const ordered = (test.question_ids as number[])
      .map((id) => bank.get(id))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map(stripAnswer);
    const questions = shuffle(ordered);

    const secret = Deno.env.get("FUNCTION_JWT_SECRET");
    if (!secret) return json({ error: "Server misconfigured" }, 500);
    const token = await signJwt({
      test_id,
      user_id: caller.user_id,
      exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60,
    }, secret);

    return json({ token, test_name: test.name, questions });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: (e as Error).message }, 500);
  }
});
