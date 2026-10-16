import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform';

// Android-only: toggles FLAG_SECURE (blocks screenshots/recording). Used while paid content is on
// screen, so buyers can still screenshot things like the payment QR elsewhere in the app.
const ScreenGuard = registerPlugin<{ enable(): Promise<void>; disable(): Promise<void> }>('ScreenGuard');

export const blockScreenshots = (on: boolean) => (isNative ? (on ? ScreenGuard.enable() : ScreenGuard.disable()).catch(() => undefined) : Promise.resolve());
