export const peso = (n: number | string) =>
  '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pesoShort = (n: number | string) => '₱' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 0 });

export const dateTime = (s?: string | null) =>
  s ? new Date(s).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const dateOnly = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export function ago(s?: string | null) {
  if (!s) return '—';
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export const initials = (name: string, email = '') =>
  (name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function bytes(n: number) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

const rawMsg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e));
// database/network wording people shouldn't have to read
const PLAIN: [RegExp, string][] = [
  [/single JSON object|PGRST116|no rows/i, "We couldn't find that. It may have been removed, or the link is wrong."],
  [/failed to fetch|networkerror|load failed|network request failed/i, "Can't reach MedNotes right now. Check your internet connection and try again."],
  [/jwt expired|invalid jwt|refresh token/i, 'Your session has ended. Please sign in again.'],
  [/row-level security|permission denied|not authorized|admin only/i, "You don't have access to this."],
  [/duplicate key|already exists/i, 'That already exists.'],
  [/timeout|timed out/i, 'That took too long. Please try again.'],
];
export const errMsg = (e: unknown) => { const m = rawMsg(e); return PLAIN.find(([re]) => re.test(m))?.[1] ?? m; };
