import { ed25519 } from '@noble/curves/ed25519';

export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function generateKeypair(): Keypair {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

export function verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  if (typeof btoa !== 'undefined') {
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
  return Buffer.from(bytes).toString('base64url');
}

export function base64urlToBytes(base64url: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    const binary = atob(padded);
    return new Uint8Array(binary.split('').map(c => c.charCodeAt(0)));
  }
  return new Uint8Array(Buffer.from(base64url, 'base64url'));
}
