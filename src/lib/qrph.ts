// QR Ph (EMVCo merchant-presented QR) helpers: read the publisher's static GCash QR and
// rebuild it per purchase with the exact amount (tag 54) and a fresh CRC (tag 63).
// Spec: EMVCo QRCPS-MPM; QR Ph follows it. Each field is ID (2 digits) + length (2 digits) + value.

export interface Tlv { id: string; value: string }

export function parseTlv(payload: string): Tlv[] {
  const out: Tlv[] = [];
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(len) || i + 4 + len > payload.length) throw new Error('Not an EMV QR code');
    out.push({ id, value: payload.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return out;
}

const field = ({ id, value }: Tlv) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as EMV QR requires. Returns 4 uppercase hex digits. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** True for a well-formed EMV/QR Ph payload whose checksum matches. */
export function isQrPh(payload: string): boolean {
  try {
    if (!payload.startsWith('000201')) return false;
    const tlvs = parseTlv(payload);
    const last = tlvs[tlvs.length - 1];
    return !!last && last.id === '63' && last.value.length === 4 && crc16(payload.slice(0, -4)) === last.value.toUpperCase();
  } catch {
    return false;
  }
}

/** Returns a dynamic copy of a static QR Ph payload with the amount set (PHP, 2 decimals). */
export function withAmount(payload: string, amount: number): string {
  if (!isQrPh(payload)) throw new Error('Not a valid QR Ph code');
  const tlvs = parseTlv(payload).filter((t) => t.id !== '63' && t.id !== '54');
  const poi = tlvs.find((t) => t.id === '01');
  if (poi) poi.value = '12'; else tlvs.splice(1, 0, { id: '01', value: '12' }); // 12 = dynamic (one-time amount)
  const amt = { id: '54', value: amount.toFixed(2) };
  const at = tlvs.findIndex((t) => Number(t.id) > 54);
  tlvs.splice(at === -1 ? tlvs.length : at, 0, amt);
  const body = tlvs.map(field).join('') + '6304';
  return body + crc16(body);
}

/** Display info from the QR: merchant/account name (59), city (60), amount if any (54). */
export function describe(payload: string) {
  const t = Object.fromEntries(parseTlv(payload).map((x) => [x.id, x.value]));
  return { name: t['59'] ?? '', city: t['60'] ?? '', amount: t['54'] ? Number(t['54']) : null, currency: t['53'] ?? '' };
}
