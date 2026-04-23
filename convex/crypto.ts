/**
 * Web Crypto helpers — AES-256-GCM encryption and HMAC-SHA256 verification.
 * Uses globalThis.crypto (available in both Edge and Node.js runtimes).
 * Import only from actions or HTTP routes — never from queries/mutations.
 */

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Returns base64( iv[12] || ciphertext+authTag ).
 */
export async function encryptCookie(plaintext: string, keyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", hexToBytes(keyHex), { name: "AES-GCM" }, false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a value produced by encryptCookie.
 */
export async function decryptCookie(encoded: string, keyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await crypto.subtle.importKey(
    "raw", hexToBytes(keyHex), { name: "AES-GCM" }, false, ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plain);
}

/**
 * Timing-safe HMAC-SHA256 verification.
 * Message format: "timestamp=<epochSeconds>"
 */
export async function verifyHmac(
  secret: string,
  timestamp: string,
  signatureHex: string
): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(`timestamp=${timestamp}`));
    const expected = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (expected.length !== signatureHex.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++)
      diff |= expected.charCodeAt(i) ^ signatureHex.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}
