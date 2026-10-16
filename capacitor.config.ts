import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mednotes.elibrary',
  appName: 'MedNotes',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false },
};

export default config;
