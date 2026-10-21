// MedNotes desktop app (Windows .exe / Mac .dmg). It opens the live web app in its own window,
// so it's always up to date, and the window can't be screenshotted, recorded or screen-shared.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

const START = process.env.MEDNOTES_URL || 'https://unknowndevice077.github.io/MedNotes-E-Library/';

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 380,
    minHeight: 560,
    title: 'MedNotes',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  // Windows 10 2004+ and macOS: the window shows up black in screenshots, recordings and screen sharing
  win.setContentProtection(true);

  // drop the Electron bits from the user agent (Google sign-in refuses "embedded" browsers) and tag it
  // so the web app knows it's running in the desktop app
  const ua = win.webContents.getUserAgent().split(' ').filter((p) => !/^(Electron|MedNotes|mednotes-desktop)\//i.test(p)).join(' ');
  win.webContents.setUserAgent(`${ua} MedNotesDesktop/${app.getVersion()}`);

  // new tabs / target=_blank go to the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 = aborted, e.g. a redirect
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { u: url && url.startsWith('http') ? url : START } });
  });

  win.on('closed', () => { win = null; });
  win.loadURL(START);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  // Mac keeps its standard menu (copy / paste / quit shortcuts live there); Windows gets none
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
