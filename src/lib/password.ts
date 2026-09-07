import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

const N = 16_384
const R = 8
const P = 1
const KEY_LENGTH = 64

function derive(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error)
      else resolve(derived as Buffer)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 32 * 1024 * 1024 })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const [algorithm, nText, rText, pText, saltText, hashText] = encoded.split('$')
    if (algorithm !== 'scrypt' || !nText || !rText || !pText || !saltText || !hashText) return false
    const n = Number(nText), r = Number(rText), p = Number(pText)
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || n < 1024 || n > 262_144) return false
    const salt = Buffer.from(saltText, 'base64url')
    const expected = Buffer.from(hashText, 'base64url')
    if (salt.length < 8 || expected.length !== KEY_LENGTH) return false
    const actual = await derive(password, salt, expected.length, { N: n, r, p, maxmem: 64 * 1024 * 1024 })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
