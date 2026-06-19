const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58btcEncode(bytes: Uint8Array): string {
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte === 0) leadingZeros++;
    else break;
  }

  let num = BigInt(0);
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte);
  }

  let result = '';
  while (num > BigInt(0)) {
    const remainder = Number(num % BigInt(58));
    result = (BASE58_ALPHABET[remainder] ?? '') + result;
    num = num / BigInt(58);
  }

  return '1'.repeat(leadingZeros) + result;
}

export function base58btcDecode(s: string): Uint8Array {
  let num = BigInt(0);
  let leadingZeros = 0;

  for (const char of s) {
    if (char === '1' && num === BigInt(0)) {
      leadingZeros++;
      continue;
    }
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * BigInt(58) + BigInt(index);
  }

  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }

  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes]);
}
