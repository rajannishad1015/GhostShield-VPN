const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class StealthLauncher {
  constructor() {
    this.knownBrowsers = [
      { name: 'Google Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
      { name: 'Google Chrome (x86)', path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
      { name: 'Google Chrome (User)', path: `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` },
      { name: 'Microsoft Edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
      { name: 'Microsoft Edge (64-bit)', path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
      { name: 'Brave Browser', path: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' },
      { name: 'Brave Browser (User)', path: `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe` }
    ];
    this.profilesBaseDir = path.resolve(__dirname, 'sandbox_profiles');
    if (!fs.existsSync(this.profilesBaseDir)) {
      fs.mkdirSync(this.profilesBaseDir, { recursive: true });
    }
    this.activeSessions = new Map();
  }

  detectBrowser() {
    for (const b of this.knownBrowsers) {
      if (b.path && fs.existsSync(b.path)) {
        return b;
      }
    }
    return null;
  }

  launch({ url = 'https://web.telegram.org/a/', incognito = false, customBrowserPath = null, socksPort = 9050, noProxy = false, bypassList = [] }) {
    let browser = null;
    if (customBrowserPath && fs.existsSync(customBrowserPath)) {
      browser = { name: 'Custom Browser', path: customBrowserPath };
    } else {
      browser = this.detectBrowser();
    }

    if (!browser) {
      throw new Error('No supported browser (Chrome, Edge, Brave) found on the system.');
    }

    // Only bypass local loopback so all external internet and Cloudflare traffic is 100% Tor routed
    const defaultBypass = [
      '<-loopback>',
      'localhost',
      '127.0.0.1'
    ];

    const allBypass = Array.from(new Set([...defaultBypass, ...(bypassList || [])]));

    // Keep Telegram logged in by reusing a persistent dedicated profile unless incognito is set
    const isTelegram = url.includes('telegram.org');
    const sessionId = (isTelegram && !incognito) ? 'telegram_session' : `session_${Date.now()}`;
    const profileDir = path.join(this.profilesBaseDir, sessionId);
    fs.mkdirSync(profileDir, { recursive: true });

    // Base Chrome performance, privacy flags, disable extensions, and block WebRTC IP leaks
    const args = [
      `--user-data-dir=${profileDir}`,
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--enforce-webrtc-ip-permission-check',
      '--disable-features=CalculateNativeWinOcclusion,BackgroundResourceBudget,InterestCohort',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-default-apps',
      '--password-store=basic',
      '--window-size=1280,850'
    ];

    if (!noProxy) {
      // 100% Tor routed for Telegram and web traffic
      args.push(`--proxy-server=socks5://127.0.0.1:${socksPort}`);
      // Smart Split-Routing: Whitelisted bot verification targets bypass Tor directly to prevent Cloudflare 403 blocks
      args.push(`--proxy-bypass-list=${allBypass.join(';')}`);
    } else {
      // Direct connection mode
      args.push('--proxy-server=direct://');
    }

    if (incognito) {
      args.push('--incognito');
    }

    args.push(url);

    const child = spawn(browser.path, args, {
      detached: true,
      stdio: 'ignore'
    });

    child.unref();

    const sessionInfo = {
      id: sessionId,
      browserName: browser.name,
      url,
      profileDir,
      launchedAt: new Date().toLocaleTimeString(),
      pid: child.pid,
      smartBypass: !noProxy,
      bypassedDomains: allBypass
    };

    this.activeSessions.set(sessionId, sessionInfo);
    return sessionInfo;
  }

  getActiveSessions() {
    return Array.from(this.activeSessions.values());
  }
}

module.exports = StealthLauncher;
