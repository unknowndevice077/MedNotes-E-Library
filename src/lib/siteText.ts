// Every piece of buyer-facing wording the admin can rewrite in Admin → Appearance.
// Saved in settings.theme.copy as { key: text }; an empty value means "use the default".

export const TEXT = {
  // header, tabs and footer (on every page after sign-in)
  'nav.library': 'Library',
  'nav.myFiles': 'My files',
  'nav.devices': 'Devices',
  'nav.account': 'Profile',
  'nav.search': 'Search notes, books, lectures…',
  'footer.text': 'Medical notes, e-books, lectures and slides from trusted publishers. Files are view-only and protected for each buyer.',
  'footer.colLibrary': 'Library',
  'footer.colHelp': 'Help',
  'footer.bottom': 'Files are licensed to your account and can only be viewed in MedNotes.',

  'auth.title': 'Your medical review library, in one place.',
  'auth.text': 'Notes, e-books, lectures and slides from trusted publishers. Preview the cover for free and unlock the full file once your payment is confirmed.',
  'auth.appTitle': 'Get the MedNotes app',
  'auth.appSub': 'Scan to download for Android',
  'auth.appPitch': 'The app is better: read offline, anywhere, and stay signed in.',
  'signin.title': 'Welcome back',
  'signin.sub': 'Sign in to continue to your library.',
  'signin.divider': 'or sign in with email',
  'signin.button': 'Sign in',
  'signin.newPrompt': 'New to MedNotes?',
  'signin.newLink': 'Create an account',
  'signin.note': "Sign in once and we'll remember you on this device. Each account works on 1 computer and 1 phone.",

  'signup.title': 'Create your account',
  'signup.sub': 'Free to join. Pay only for the files you want.',
  'signup.divider': 'or with email',
  'signup.terms': 'By creating an account you agree to the Terms and the Device Policy (1 computer + 1 phone).',
  'signup.button': 'Create account',
  'signup.havePrompt': 'Already have an account?',
  'signup.haveLink': 'Sign in',

  'forgot.title': 'Reset your password',
  'forgot.sub': "Enter your email and we'll send you a reset link.",
  'forgot.button': 'Send reset link',
  'forgot.back': 'Back to sign in',

  'library.announcement': '',
  'library.heroTitle': 'What are you reviewing today?',
  'library.heroText': 'Preview any cover for free. Buy a file once, then read it on your computer and phone.',
  'library.statUnlocked': 'Owned',
  'library.statWaiting': 'Waiting',
  'library.statTotal': 'In library',
  'library.continue': 'Continue reading',
  'library.free': 'Free samples',
  'library.freeSub': 'Read these without paying',
  'library.new': 'New arrivals',
  'library.all': 'All files',
  'library.empty': 'No files match',
  'library.emptySub': 'Try another search or filter.',

  'detail.buy': 'Buy this file',
  'detail.read': 'Read now',
  'detail.readFree': 'Read free sample',
  'detail.waiting': 'Waiting for confirmation',
  'detail.priceLabel': 'Price',
  'detail.step1': 'Send payment',
  'detail.step2': 'Publisher confirms',
  'detail.step3': 'Receipt & read',
  'detail.perk1': 'View-only inside MedNotes, never downloadable',
  'detail.perk2': 'Read on 1 computer in your browser',
  'detail.perk3': 'and 1 phone in the app',
  'detail.perk4': 'Licensed to your account only',
  'detail.lockedSub': 'Only the cover is free to preview.',

  'checkout.title': 'Pay for your file',
  'checkout.sendTo': 'Send payment to',
  'checkout.proof': 'Upload your payment screenshot',
  'checkout.drop': 'Drop your screenshot here, or tap to choose it',
  'checkout.submit': 'Submit payment for confirmation',
  'checkout.summary': 'Amount to pay',
  'checkout.summaryNote': 'The publisher checks every payment by hand. This usually takes less than 24 hours.',

  'myfiles.title': 'My files',
  'myfiles.sub': 'Everything you bought, with payment status and receipts.',
  'myfiles.empty': 'No files yet',

  'devices.title': 'Your devices',
  'devices.buyTitle': 'Need another device?',
  'devices.buyText': 'Buy an extra slot once and keep it. Pay by GCash; the slot is added as soon as the publisher confirms your payment.',
  'devices.askText': 'Need another device? Ask the publisher. Admins can grant extra slots or reset your devices.',
  'devices.swaps': 'Device swaps used',

  'account.title': 'Profile',
  'account.prefs': 'Reading & app',
  'account.methods': 'Sign-in methods',
  'account.signOut': 'Sign out',
  'account.deleteText': 'Removes your profile, devices, payment proofs, purchases and access to your files.',
} as const;

export type TextKey = keyof typeof TEXT;

// texts that used to be separate theme fields; still read so older saved themes keep working
export const LEGACY: Partial<Record<TextKey, 'authTitle' | 'authText' | 'heroTitle' | 'heroText' | 'footerText' | 'announcement'>> = {
  'auth.title': 'authTitle', 'auth.text': 'authText', 'library.heroTitle': 'heroTitle', 'library.heroText': 'heroText',
  'footer.text': 'footerText', 'library.announcement': 'announcement',
};

export interface SitePage {
  id: string; label: string;
  /** route shown in the preview; ":file" is replaced with a real file id */
  path: string;
  match: RegExp;
  needsFile?: boolean;
  groups: { title: string; keys: TextKey[] }[];
}

const SHARED = { title: 'Header & footer (every page)', keys: ['nav.library', 'nav.myFiles', 'nav.devices', 'nav.account', 'nav.search', 'footer.text', 'footer.colLibrary', 'footer.colHelp', 'footer.bottom'] as TextKey[] };

export const SITE_PAGES: SitePage[] = [
  { id: 'sign-in', label: 'Sign in', path: '/sign-in', match: /^\/sign-in/, groups: [
    { title: 'Welcome side', keys: ['auth.title', 'auth.text', 'auth.appTitle', 'auth.appSub', 'auth.appPitch'] },
    { title: 'Sign-in form', keys: ['signin.title', 'signin.sub', 'signin.divider', 'signin.button', 'signin.newPrompt', 'signin.newLink', 'signin.note'] },
  ] },
  { id: 'sign-up', label: 'Create account', path: '/sign-up', match: /^\/sign-up/, groups: [
    { title: 'Sign-up form', keys: ['signup.title', 'signup.sub', 'signup.divider', 'signup.terms', 'signup.button', 'signup.havePrompt', 'signup.haveLink'] },
  ] },
  { id: 'forgot', label: 'Forgot password', path: '/forgot-password', match: /^\/forgot-password/, groups: [
    { title: 'Reset form', keys: ['forgot.title', 'forgot.sub', 'forgot.button', 'forgot.back'] },
  ] },
  { id: 'library', label: 'Library (home)', path: '/library', match: /^\/library/, groups: [
    { title: 'Top of the page', keys: ['library.announcement', 'library.heroTitle', 'library.heroText', 'library.statUnlocked', 'library.statWaiting', 'library.statTotal'] },
    { title: 'Shelves', keys: ['library.continue', 'library.free', 'library.freeSub', 'library.new', 'library.all', 'library.empty', 'library.emptySub'] },
    SHARED,
  ] },
  { id: 'detail', label: 'File details', path: '/file/:file', match: /^\/file\//, needsFile: true, groups: [
    { title: 'Buy panel', keys: ['detail.priceLabel', 'detail.buy', 'detail.read', 'detail.readFree', 'detail.waiting'] },
    { title: 'How buying works', keys: ['detail.step1', 'detail.step2', 'detail.step3'] },
    { title: 'What buyers get', keys: ['detail.perk1', 'detail.perk2', 'detail.perk3', 'detail.perk4', 'detail.lockedSub'] },
    SHARED,
  ] },
  { id: 'checkout', label: 'Checkout', path: '/checkout/:file', match: /^\/checkout\//, needsFile: true, groups: [
    { title: 'Payment', keys: ['checkout.title', 'checkout.sendTo', 'checkout.proof', 'checkout.drop', 'checkout.submit', 'checkout.summary', 'checkout.summaryNote'] },
  ] },
  { id: 'my-files', label: 'My files', path: '/my-files', match: /^\/my-files/, groups: [
    { title: 'My files', keys: ['myfiles.title', 'myfiles.sub', 'myfiles.empty'] }, SHARED,
  ] },
  { id: 'devices', label: 'Devices', path: '/devices', match: /^\/devices/, groups: [
    { title: 'Devices', keys: ['devices.title', 'devices.buyTitle', 'devices.buyText', 'devices.askText', 'devices.swaps'] }, SHARED,
  ] },
  { id: 'account', label: 'Account', path: '/account', match: /^\/account/, groups: [
    { title: 'Account', keys: ['account.title', 'account.prefs', 'account.methods', 'account.signOut', 'account.deleteText'] }, SHARED,
  ] },
];

export const pageOf = (key: TextKey) => SITE_PAGES.find((p) => p.groups.some((g) => g.title !== SHARED.title && g.keys.includes(key)));

/** Human label for a field in the editor, e.g. 'signin.newLink' → 'New link'. */
export function fieldLabel(key: TextKey) {
  const NAMES: Partial<Record<TextKey, string>> = {
    'library.announcement': 'Announcement bar (optional)', 'library.heroTitle': 'Welcome title', 'library.heroText': 'Welcome text',
    'auth.title': 'Headline', 'auth.text': 'Text under the headline', 'library.statUnlocked': 'Count label: owned', 'library.statWaiting': 'Count label: waiting', 'library.statTotal': 'Count label: in library', 'nav.search': 'Search box hint', 'footer.text': 'Footer text', 'footer.bottom': 'Footer fine print',
  };
  if (NAMES[key]) return NAMES[key]!;
  const last = key.split('.')[1]!.replace(/([A-Z0-9])/g, ' $1').toLowerCase();
  return last[0]!.toUpperCase() + last.slice(1);
}

export const isLong = (key: TextKey) => TEXT[key].length > 60 || key === 'library.announcement';

/** True inside the Admin → Appearance preview frame: clicks pick text instead of acting, nothing is saved from here. */
export const SITE_EDIT = (() => {
  try { return window.parent !== window && new URLSearchParams(window.location.search).has('site-edit'); } catch { return false; }
})();
