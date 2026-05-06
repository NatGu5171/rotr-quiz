// Edge-compatible password hashing. Avoid third-party bcrypt modules here:
// some spawn Web Workers, which Supabase Edge Functions do not expose.
const FORMAT = "pbkdf2-sha256";
const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const encoder = new TextEncoder();

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(plain, salt, ITERATIONS);
  return [FORMAT, ITERATIONS, toBase64Url(salt), toBase64Url(key)].join("$");
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const parts = hash.split("$");
  if (parts.length !== 4 || parts[0] !== FORMAT) return false;

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;

  const salt = fromBase64Url(parts[2]);
  const expected = fromBase64Url(parts[3]);
  const actual = await deriveKey(plain, salt, iterations);
  return timingSafeEqual(actual, expected);
}

async function deriveKey(plain: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(plain),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
