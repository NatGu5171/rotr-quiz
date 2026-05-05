// bcrypt wrapper. Uses the pure-JS bcrypt port that runs in Deno.
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

export async function hashPassword(plain: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(plain, salt);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(plain, hash);
}
