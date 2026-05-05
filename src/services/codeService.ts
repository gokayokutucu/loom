const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function bytesFromUuid(uuid: string) {
  const hex = uuid.replace(/-/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return bytes;
}

function fallbackUuid() {
  return `meta-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createMetadataUuid() {
  return globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
}

export function shortCodeFromUuid(uuid: string, length = 5) {
  const bytes = bytesFromUuid(uuid);
  if (bytes.length === 0) {
    return Math.random()
      .toString(36)
      .replace(/[^a-z0-9]/gi, "")
      .toUpperCase()
      .slice(0, length)
      .padEnd(length, "0");
  }

  let value = 0;
  for (let index = 0; index < Math.min(bytes.length, 5); index += 1) {
    value = (value * 256 + bytes[index]) >>> 0;
  }

  let code = "";
  while (code.length < length) {
    code = CROCKFORD_BASE32[value % 32] + code;
    value = Math.floor(value / 32);
  }
  return code.slice(-length);
}

export function createLoomCode(uuid: string) {
  return `L-${shortCodeFromUuid(uuid)}`;
}

export function createResponseCode(uuid: string) {
  return `R-${shortCodeFromUuid(uuid)}`;
}
