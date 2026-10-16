import { Capacitor } from '@capacitor/core';

/** True inside the Android app (Capacitor), false in any browser. */
export const isNative = Capacitor.isNativePlatform();

/** Phones (the app, or a mobile browser) use the phone slot; everything else is a computer. */
export function deviceKind(): 'computer' | 'phone' {
  if (isNative) return 'phone';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'phone' : 'computer';
}

/** Short human label shown on the Devices page, e.g. "Windows PC · Chrome". */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows PC' : /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua) ? 'Mac'
    : /Android/.test(ua) ? (ua.match(/Android [^;]*;\s*([^;)]+)/)?.[1]?.trim() || 'Android phone')
    : /iPhone|iPad/.test(ua) ? 'iPhone' : /Linux/.test(ua) ? 'Linux PC' : 'Device';
  if (isNative) return `${os} · MedNotes app`;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${browser}`;
}

export const platformName = isNative ? 'android-app' : 'web';
