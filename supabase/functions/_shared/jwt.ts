// Tiny HS256 sign/verify. Uses Web Crypto, no external dep.

import { decodeBase64Url, encodeBase64Url } from "https://deno.land/std@0.224.0/encoding/base64url.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function key(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const h = encodeBase64Url(enc.encode(JSON.stringify(header)));
  const p = encodeBase64Url(enc.encode(JSON.stringify(payload)));
  const data = `${h}.${p}`;
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(data));
  return `${data}.${encodeBase64Url(new Uint8Array(sig))}`;
}

export async function verifyJwt<T = Record<string, unknown>>(
  token: string,
  secret: string,
): Promise<T> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [h, p, s] = parts;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await key(secret),
    decodeBase64Url(s),
    enc.encode(`${h}.${p}`),
  );
  if (!ok) throw new Error("Invalid signature");
  const payload = JSON.parse(dec.decode(decodeBase64Url(p))) as T & { exp?: number };
  if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error("Token expired");
  return payload as T;
}
