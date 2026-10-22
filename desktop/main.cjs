// MedNotes desktop app (Windows .exe / Mac .dmg). It opens the live web app in its own window,
// so it's always up to date, and the window can't be screenshotted, recorded or screen-shared.
const { app, BrowserWindow, Menu, WebContentsView, shell } = require('electron');
const { execFile } = require('child_process');
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

  win.on('closed', () => { win = null; cover = null; });
  win.on('resize', fitCover);
  win.loadURL(START);
}

// Screen capture / recording apps. The window already shows black to them; on top of that the content
// is covered while one is running, so a capture of the whole screen (or a phone pointed at it) gets nothing.
const RECORDERS = {
  win32: ['snippingtool.exe', 'screenclippinghost.exe', 'obs64.exe', 'obs32.exe', 'obs.exe', 'streamlabs obs.exe', 'bdcam.exe',
    'camtasiarecorder.exe', 'camrecorder.exe', 'sharex.exe', 'screenrec.exe', 'snagit32.exe', 'snagitcapture.exe', 'snagiteditor.exe',
    'flashbackrecorder.exe', 'apowerrec.exe', 'xsplit.core.exe', 'action_x64.exe', 'loom.exe', 'lightshot.exe', 'greenshot.exe',
    'picpick.exe', 'gyazo.exe', 'screenpresso.exe', 'icecreamscreenrecorder.exe', 'fsrecorder.exe', 'mirillis action!.exe'],
  darwin: ['obs', 'screenflow', 'loom', 'cleanshot x', 'kap', 'snagit', 'camtasia', 'screenshot'],
};
let cover = null;

function runningApps() {
  return new Promise((resolve) => {
    const [cmd, args] = process.platform === 'win32' ? ['tasklist', ['/fo', 'csv', '/nh']] : ['ps', ['-axco', 'comm']];
    execFile(cmd, args, { windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => {
      if (err) return resolve([]);
      resolve(out.split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/)?.[1] ?? l).trim().toLowerCase()).filter(Boolean));
    });
  });
}

function fitCover() {
  if (!win || !cover) return;
  const [w, h] = win.getContentSize();
  cover.setBounds({ x: 0, y: 0, width: w, height: h });
}

function setCovered(on, names) {
  if (!win) return;
  if (on && !cover) {
    cover = new WebContentsView({ webPreferences: { sandbox: true } });
    win.contentView.addChildView(cover);
    fitCover();
    win.webContents.executeJavaScript('document.querySelectorAll("video,audio").forEach((m) => m.pause())').catch(() => {});
  } else if (!on && cover) {
    win.contentView.removeChildView(cover);
    cover = null;
    return;
  }
  if (cover) {
    const list = names.map((n) => n.replace(/\.exe$/, '')).join(', ');
    cover.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8">
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font:16px system-ui,sans-serif;text-align:center">
<div style="max-width:420px;padding:24px"><div style="font-size:40px">&#128274;</div><h2 style="color:#fff">Screen capture is on</h2>
<p>MedNotes hides your files while screenshot or recording tools are running. Close <b>${list.replace(/[<>&"]/g, '')}</b> to keep reading.</p></div></body>`));
  }
}

let lastKey = '';
async function checkRecorders() {
  const list = RECORDERS[process.platform];
  if (!list || !win) return;
  const running = await runningApps();
  const found = list.filter((n) => running.includes(n));
  const key = found.join('|');
  if (key === lastKey) return;
  lastKey = key;
  setCovered(found.length > 0, found);
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
  checkRecorders();
  setInterval(checkRecorders, 2000);
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
