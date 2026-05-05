import { preflight, json } from "../_shared/cors.ts";
import { requireAuth, serviceClient, HttpError } from "../_shared/auth.ts";
import { verifyJwt } from "../_shared/jwt.ts";
import { loadQuestions } from "../_shared/questions.ts";
import { sendResultEmail } from "../_shared/email.ts";

interface Body {
  token: string;
  answers: { id: number; choice: "A" | "B" | "C" | "D" | null }[];
}

interface TokenPayload {
  test_id: string;
  user_id: string;
  exp: number;
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  try {
    const caller = await requireAuth(req);
    const { token, answers } = (await req.json()) as Body;
    if (!token || !Array.isArray(answers)) return json({ error: "Missing token or answers" }, 400);

    const secret = Deno.env.get("FUNCTION_JWT_SECRET");
    if (!secret) return json({ error: "Server misconfigured" }, 500);

    const payload = await verifyJwt<TokenPayload>(token, secret);
    if (payload.user_id !== caller.user_id) return json({ error: "Token user mismatch" }, 401);

    const sb = serviceClient();

    // Re-check single-attempt (defence in depth — UNIQUE will also catch it)
    const { data: existing } = await sb
      .from("test_results")
      .select("id")
      .eq("test_id", payload.test_id)
      .eq("user_id", caller.user_id)
      .maybeSingle();
    if (existing) return json({ error: "You have already taken this test." }, 409);

    const { data: test, error: tErr } = await sb
      .from("tests")
      .select("id, name, question_ids")
      .eq("id", payload.test_id)
      .single();
    if (tErr || !test) return json({ error: "Test not found" }, 404);

    const bank = await loadQuestions();
    const allowed = new Set<number>(test.question_ids as number[]);
    const answerMap = new Map<number, string | null>();
    for (const a of answers) if (allowed.has(a.id)) answerMap.set(a.id, a.choice);

    let correct = 0;
    const total = (test.question_ids as number[]).length;
    for (const id of test.question_ids as number[]) {
      const q = bank.get(id);
      const a = answerMap.get(id) ?? null;
      if (q && a && a === q.correct_answer) correct++;
    }
    const pct    = +(correct / total * 100).toFixed(2);
    const passed = pct >= 90;

    // Membership snapshot
    const { data: mem } = await sb
      .from("user_memberships")
      .select("subgroup_id, subgroups:subgroup_id(name, group_id, groups:group_id(name))")
      .eq("user_id", caller.user_id)
      .maybeSingle();

    const subgroup_id   = mem?.subgroup_id ?? null;
    // deno-lint-ignore no-explicit-any
    const sg: any       = (mem as any)?.subgroups;
    const subgroup_name = sg?.name ?? null;
    const group_id      = sg?.group_id ?? null;
    const group_name    = sg?.groups?.name ?? null;

    const { error: insErr } = await sb.from("test_results").insert({
      test_id:       payload.test_id,
      test_name:     test.name,
      user_id:       caller.user_id,
      taker_email:   caller.email,
      subgroup_id, subgroup_name, group_id, group_name,
      correct, total, pct, passed,
    });
    if (insErr) {
      if (insErr.code === "23505") return json({ error: "You have already taken this test." }, 409);
      return json({ error: insErr.message }, 500);
    }

    let email_sent = true;
    try {
      await sendResultEmail({
        to:            caller.email,
        test_name:     test.name,
        group_name, subgroup_name,
        date_iso:      new Date().toISOString().replace("T", " ").substring(0, 16) + " UTC",
        correct, total, pct, passed,
      });
    } catch (e) {
      // Result is recorded; don't fail the submission if email transport breaks.
      email_sent = false;
      console.error("Email send failed:", (e as Error).message);
    }

    return json({ correct, total, pct, passed, email_sent });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: (e as Error).message }, 500);
  }
});
