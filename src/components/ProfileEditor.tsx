import { useState, type ReactNode, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';
import { useToast } from './ui';

const MAX = 2 * 1024 * 1024;

/** Squares and shrinks a photo to 256 px so avatars stay small and load fast. */
async function squareAvatar(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height), size = Math.min(256, side);
  const c = document.createElement('canvas'); c.width = c.height = size;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('Could not read that image'))), 'image/jpeg', 0.88));
}

/** Profile picture + name, for buyers (Account) and admins (Admin → Settings). */
export default function ProfileEditor({ hint = 'Shown on your receipts.', action }: { hint?: string; action?: ReactNode }) {
  const { profile, patchProfile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [busy, setBusy] = useState(false);
  if (!profile) return null;

  async function photo(file?: File | null) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return toast('Use a JPG, PNG or WebP photo.');
    if (file.size > 10 * MAX) return toast('That photo is too large.');
    setBusy(true);
    try {
      const blob = await squareAvatar(file);
      const path = `${profile!.id}/avatar-${Date.now().toString(36)}.jpg`;
      const up = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw up.error;
      const avatar_url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from('profiles').update({ avatar_url }).eq('id', profile!.id);
      if (error) throw error;
      // tidy up older pictures in the folder
      const { data: old } = await supabase.storage.from('avatars').list(profile!.id);
      const stale = (old ?? []).map((o) => `${profile!.id}/${o.name}`).filter((p) => p !== path);
      if (stale.length) await supabase.storage.from('avatars').remove(stale);
      patchProfile({ avatar_url });
      toast('Profile picture updated.');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not upload the photo.'); } finally { setBusy(false); }
  }
  async function removePhoto() {
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', profile!.id);
    if (error) return toast(error.message);
    patchProfile({ avatar_url: null }); toast('Profile picture removed.');
  }
  async function saveName(e: FormEvent) {
    e.preventDefault();
    const full_name = name.trim();
    const { error } = await supabase.from('profiles').update({ full_name }).eq('id', profile!.id);
    if (error) return toast(error.message);
    await supabase.auth.updateUser({ data: { full_name } });
    patchProfile({ full_name }); toast('Name saved.');
  }

  return (
    <form className="card col" onSubmit={saveName}>
      <div className="spread"><h3>Profile</h3>{action}</div>
      <div className="row" style={{ gap: 16 }}>
        <span className="avatar avatar-lg">{profile.avatar_url ? <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials(profile.full_name, profile.email)}</span>
        <div className="col" style={{ gap: 6, minWidth: 0 }}>
          <span className="small muted ellipsis">{profile.email}</span>
          <div className="row" style={{ gap: 8 }}>
            <label className="btn btn-sm">{busy ? 'Uploading…' : profile.avatar_url ? 'Change photo' : 'Add a photo'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Profile picture" onChange={(e) => photo(e.target.files?.[0])} /></label>
            {profile.avatar_url && <button type="button" className="btn btn-sm" onClick={removePhoto}>Remove</button>}
          </div>
          <span className="small muted">JPG, PNG or WebP. Cropped to a square.</span>
        </div>
      </div>
      <div className="field"><label htmlFor="nm">Full name</label><input id="nm" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <span className="small muted">{hint}</span>
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Save name</button>
    </form>
  );
}
