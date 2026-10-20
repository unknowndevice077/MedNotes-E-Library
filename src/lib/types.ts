export type FileKind = 'epub' | 'pdf' | 'video' | 'image' | 'docx' | 'pptx' | 'xlsx' | 'other';
export type PurchaseStatus = 'pending' | 'confirmed' | 'rejected';

export interface Settings {
  store_name: string; support_email: string; publisher_name: string; watermark_note: string;
  receipt_business: string; receipt_tin: string; receipt_prefix: string; receipt_next: number; receipt_footer: string;
  computer_slots: number; phone_slots: number; swaps_per_30d: number; users_can_add_devices: boolean;
  allow_download_default: boolean; offline_saving: boolean; offline_days: number; watermark: boolean; block_screenshots: boolean;
  payment_methods: PaymentMethod[];
  receipt_design: ReceiptDesign; theme: Theme;
}
export interface ReceiptDesign {
  title?: string; accent?: string; showLogo?: boolean; address?: string; contact?: string; showTin?: boolean;
  showReference?: boolean; showBuyerEmail?: boolean; footer?: string; paper?: 'card' | 'a5' | 'thermal';
}
export interface Theme {
  primary?: string; accent?: string; ink?: string;
  background?: { type: 'plain' | 'gradient' | 'image'; color?: string; color2?: string; image?: string; overlay?: number };
  authImage?: string; logo?: string; storeName?: string; heroTitle?: string; heroText?: string;
  radius?: number; font?: 'Inter' | 'Poppins' | 'Nunito' | 'Merriweather' | 'System';
}
export interface UserPrefs { readerTheme?: 'light' | 'sepia' | 'dark'; textSize?: number; reduceMotion?: boolean; startPage?: 'library' | 'my-files' }
export interface PaymentMethod { name: string; account: string; holder: string; enabled: boolean; qr_path?: string | null; qr_payload?: string | null }

export interface Profile {
  id: string; email: string; full_name: string; avatar_url: string | null; provider: string;
  role: 'client' | 'admin'; suspended: boolean;
  computer_slots: number | null; phone_slots: number | null; swaps_per_30d: number | null;
  allow_download: boolean | null; can_add_devices: boolean | null; admin_note: string; created_at: string; prefs: UserPrefs;
}

export interface LibFile {
  id: string; name: string; label: string; description: string; price: number; kind: FileKind; mime: string;
  storage_path: string | null; cover_path: string | null; size_bytes: number; meta: string;
  allow_download: boolean; published: boolean; created_at: string;
}

export interface Purchase {
  id: string; user_id: string; file_id: string; amount: number; method: string; reference_no: string;
  proof_path: string | null; status: PurchaseStatus; reject_reason: string; note_to_buyer: string;
  receipt_no: string | null; created_at: string; confirmed_at: string | null;
  files?: LibFile; profiles?: Pick<Profile, 'id' | 'email' | 'full_name' | 'avatar_url'>;
}

export interface Device { id: string; user_id: string; device_id: string; kind: 'computer' | 'phone'; label: string; platform: string; last_seen: string; created_at: string }

export const KIND_LABEL: Record<FileKind, string> = {
  epub: 'EPUB', pdf: 'PDF', video: 'Video', image: 'Image', docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel', other: 'File',
};
export const KIND_TAG: Record<FileKind, string> = {
  epub: 'EPUB', pdf: 'PDF', video: 'VIDEO', image: 'IMAGE', docx: 'DOCX', pptx: 'PPTX', xlsx: 'XLSX', other: 'FILE',
};

export function kindFromName(name: string, mime = ''): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'epub') return 'epub';
  if (ext === 'pdf') return 'pdf';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext) || mime.startsWith('video/')) return 'video';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) || mime.startsWith('image/')) return 'image';
  if (['docx', 'doc'].includes(ext)) return 'docx';
  if (['pptx', 'ppt'].includes(ext)) return 'pptx';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'xlsx';
  return 'other';
}
