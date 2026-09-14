import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const KEY_LENGTH = 64;

export interface PasswordRecord {
  algorithm: "scrypt-v1";
  salt: string;
  hash: string;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, derived) => error ? reject(error) : resolve(derived));
  });
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return {
    algorithm: "scrypt-v1",
    salt: salt.toString("base64url"),
    hash: derived.toString("base64url"),
  };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  if (record.algorithm !== "scrypt-v1") return false;
  const salt = Buffer.from(record.salt, "base64url");
  const expected = Buffer.from(record.hash, "base64url");
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}

export function passwordMeetsPolicy(password: string): boolean {
  return password.length >= 12
    && password.length <= 200
    && /[A-Za-z]/u.test(password)
    && /[0-9]/u.test(password)
    && /[^A-Za-z0-9]/u.test(password);
}
