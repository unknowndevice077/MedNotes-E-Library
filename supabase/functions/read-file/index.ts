// read-file: the only way buyers can get file contents.
//
// The client sends its session's RSA-OAEP public key (the private key is non-extractable and
// lives only in that tab / app process). We check ownership + device, read the requested byte
// range from private storage, encrypt it with a fresh AES-256-GCM key and wrap that key with the
// client's public key. The network only ever carries ciphertext, and no storage URL is exposed.
//
// Request (POST JSON): { file_id, device_id, public_key (base64 SPKI), start?, end? }
// Response (binary):   [u32 wrappedKeyLength][wrappedKey][12-byte iv][AES-GCM ciphertext]
//   headers: X-Total-Size (bytes in the whole file), X-Chunk-Start, X-Chunk-End
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Total-Size, X-Chunk-Start, X-Chunk-End',
};
const MAX_CHUNK = 8 * 1024 * 1024;

const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'POST only');
  try {
    const { file_id, device_id, public_key, start, end } = await req.json();
    if (!file_id || !device_id || !public_key) return fail(400, 'file_id, device_id and public_key are required');

    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return fail(401, 'Sign in to open this file.');

    const [{ data: deviceOk }, { data: isAdmin }, { data: profile }, { data: file }] = await Promise.all([
      asUser.rpc('device_ok', { p_device_id: device_id }),
      asUser.rpc('is_admin'),
      service.from('profiles').select('suspended').eq('id', user.id).single(),
      service.from('files').select('id, storage_path, mime').eq('id', file_id).single(),
    ]);
    if (!file?.storage_path) return fail(404, 'File not found.');
    if (profile?.suspended) return fail(403, 'Your account is suspended.');
    if (!deviceOk) return fail(403, 'This device is not registered on your account.');
    if (!isAdmin) {
      const { data: owned } = await service.from('purchases').select('id')
        .eq('user_id', user.id).eq('file_id', file_id).eq('status', 'confirmed').limit(1).maybeSingle();
      if (!owned) return fail(403, 'You need to unlock this file first.');
    }

    // Byte range (chunked reads keep memory small for large lectures).
    const from = Math.max(0, Number(start ?? 0));
    const to = end == null ? from + MAX_CHUNK - 1 : Math.min(Number(end), from + MAX_CHUNK - 1);
    const { data: signed, error: se } = await service.storage.from('files').createSignedUrl(file.storage_path, 60);
    if (se || !signed) return fail(500, 'Storage error');
    const res = await fetch(signed.signedUrl, { headers: { Range: `bytes=${from}-${to}` } });
    if (!res.ok && res.status !== 206) return fail(502, `Storage returned ${res.status}`);
    const plain = new Uint8Array(await res.arrayBuffer());
    const total = Number(res.headers.get('content-range')?.split('/')[1] ?? plain.length);

    // Encrypt for this client only.
    const clientKey = await crypto.subtle.importKey('spki', b64(public_key), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plain));
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, clientKey, raw));

    const body = new Uint8Array(4 + wrapped.length + 12 + cipher.length);
    new DataView(body.buffer).setUint32(0, wrapped.length);
    body.set(wrapped, 4);
    body.set(iv, 4 + wrapped.length);
    body.set(cipher, 16 + wrapped.length);
    return new Response(body, {
      headers: {
        ...CORS,
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Total-Size': String(total),
        'X-Chunk-Start': String(from),
        'X-Chunk-End': String(from + plain.length - 1),
      },
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : String(e));
  }
});
