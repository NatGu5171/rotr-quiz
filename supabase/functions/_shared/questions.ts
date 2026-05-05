// Loads the 1030-question bank once per cold start.
// Source-of-truth: rotr_questions.json deployed alongside the static site.
// We fetch from QUESTIONS_URL (set as a function secret) so the bank stays in
// one place. Cached in module scope.

export type Choice = "A" | "B" | "C" | "D";

export interface Question {
  id: number;
  question: string;
  scope: string;
  rules: string[];
  choices: Record<Choice, string>;
  correct_answer: Choice;
  image?: string;
  identifier?: string;
}

let cache: Map<number, Question> | null = null;

export async function loadQuestions(): Promise<Map<number, Question>> {
  if (cache) return cache;
  const url = Deno.env.get("QUESTIONS_URL");
  if (!url) throw new Error("QUESTIONS_URL secret not set");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not fetch questions (${r.status})`);
  const list = (await r.json()) as Question[];
  const map = new Map<number, Question>();
  for (const q of list) map.set(q.id, q);
  cache = map;
  return map;
}

export function stripAnswer(q: Question): Omit<Question, "correct_answer"> {
  // deno-lint-ignore no-unused-vars
  const { correct_answer, ...rest } = q;
  return rest;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
