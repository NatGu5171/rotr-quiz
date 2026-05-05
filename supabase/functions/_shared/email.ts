// Resend transactional email.

interface ResultEmailInput {
  to: string;
  test_name: string;
  group_name: string | null;
  subgroup_name: string | null;
  date_iso: string;
  correct: number;
  total: number;
  pct: number;
  passed: boolean;
}

export async function sendResultEmail(i: ResultEmailInput): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from   = Deno.env.get("RESEND_FROM_ADDRESS");
  if (!apiKey || !from) throw new Error("RESEND_API_KEY / RESEND_FROM_ADDRESS not set");

  const status = i.passed ? "PASSED" : "FAILED";
  const color  = i.passed ? "#27ae60" : "#c0392b";
  const symbol = i.passed ? "&#10003;" : "&#10007;";
  const where  = i.group_name && i.subgroup_name
    ? `${escapeHtml(i.group_name)} / ${escapeHtml(i.subgroup_name)}`
    : "&mdash;";

  const subject = `[Rules of the Road] Test result — ${i.test_name} — ${status}`;

  const html = `
<!doctype html>
<html><body style="font-family: Arial, sans-serif; color:#1a2332; max-width:600px; margin:0 auto; padding:24px">
  <h2 style="color:#1a2332; border-bottom:2px solid #1a2332; padding-bottom:8px">
    Rules of the Road &mdash; Official Test Result
  </h2>
  <p><strong>Test:</strong> ${escapeHtml(i.test_name)}</p>
  <p><strong>Group / Subgroup:</strong> ${where}</p>
  <p><strong>Date:</strong> ${escapeHtml(i.date_iso)}</p>
  <p><strong>Score:</strong> ${i.correct} / ${i.total} (${i.pct.toFixed(2)}%)</p>
  <p style="font-size:1.4rem; color:${color}; margin-top:16px">
    <strong>STATUS: ${status} ${symbol}</strong>
  </p>
  <p>Pass mark: 90%.</p>
  <hr style="border:none; border-top:1px solid #ccc; margin:24px 0">
  <p style="font-size:0.8rem; color:#888">
    This is an automated message from the Rules of the Road test platform.
    This email was sent because this address is on file for the account that took the test.
  </p>
</body></html>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [i.to],
      subject,
      html,
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Resend send failed (${r.status}): ${txt}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
