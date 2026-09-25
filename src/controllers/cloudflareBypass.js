/**
 * cloudflare_bypass.js
 * 
 * Bypasses Cloudflare's bot protection (403/JS challenge) by launching
 * a stealth puppeteer-core browser routed through Tor SOCKS5 proxy.
 * 
 * Uses puppeteer-core (no bundled Chromium needed) + puppeteer-extra-plugin-stealth.
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteerCore = require('puppeteer-core');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');

// Wire stealth plugin into puppeteer-extra
puppeteerExtra.use(StealthPlugin());

// Initialize Apify statistical fingerprint generator for Windows Chrome
const fingerprintGenerator = new FingerprintGenerator({
  devices: ['desktop'],
  operatingSystems: ['windows'],
  browsers: [{ name: 'chrome', minVersion: 122 }]
});
const fingerprintInjector = new FingerprintInjector();

// Cache: domain → { cookies, userAgent, html, expiresAt }
const sessionCache = new Map();
const CACHE_TTL_MS = 25 * 60 * 1000; // 25 minutes (cf_clearance ~30min TTL)

/**
 * Solve a Cloudflare-protected URL using stealth puppeteer-core via Tor.
 * Returns { html, cookies, userAgent, success, fromCache, cfCleared }
 */
async function solveCloudflarePage(targetUrl, socksPort = 9050) {
  const urlObj = new URL(targetUrl);
  const domain = urlObj.hostname;

  // Return cached session if still valid
  const cached = sessionCache.get(domain);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[CFBypass] Using cached cf_clearance for ${domain}`);
    return { ...cached, fromCache: true, success: true };
  }

  console.log(`[CFBypass] Launching Anti-Detect stealth browser for: ${targetUrl}`);
  let browser = null;

  try {
    const chromePath = findChromePath();
    if (!chromePath) throw new Error('Chrome/Edge not found on this system');

    // Generate real-world hardware & browser statistical fingerprint
    const { fingerprint } = fingerprintGenerator.getFingerprint();
    const screenWidth = (fingerprint.screen && fingerprint.screen.width) || 1366;
    const screenHeight = (fingerprint.screen && fingerprint.screen.height) || 768;

    browser = await puppeteerCore.launch({
      headless: false, // Headless:false is mandatory for Turnstile JS challenges
      executablePath: chromePath,
      args: [
        `--proxy-server=socks5://127.0.0.1:${socksPort}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        '--disable-blink-features=AutomationControlled',
        `--window-size=${screenWidth},${screenHeight}`,
        '--window-position=-9999,0', // Off-screen to avoid disturbing the user
        '--disable-features=TranslateUI',
        '--disable-infobars',
        `--user-agent=${fingerprint.navigator.userAgent}`
      ],
      ignoreHTTPSErrors: true,
      timeout: 60000
    });

    const page = await browser.newPage();

    // 1. Inject Apify Hardware & Audio/WebGL/Canvas Fingerprint
    await fingerprintInjector.attachFingerprintToPuppeteer(page, fingerprint);

    // 2. Inject Anti-Detect Evasions (rebrowser-style CDP and cdc_ cleanup)
    await applyAdvancedEvasions(page);

    await page.setViewport({
      width: Math.min(screenWidth, 1280),
      height: Math.min(screenHeight, 800)
    });

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"'
    });

    // Navigate to target
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});

    // Try detecting and automatically clicking Cloudflare Turnstile checkbox
    await trySolveTurnstileChallenge(page);

    // Wait for challenge to clear
    console.log(`[CFBypass] Waiting for challenge resolution...`);
    const cleared = await waitForChallengeCleared(page, 30000);

    if (cleared) {
      console.log(`[CFBypass] Challenge cleared! Page: ${await page.title()}`);
      await new Promise(r => setTimeout(r, 1500));
    } else {
      const title = await page.title().catch(() => '?');
      console.log(`[CFBypass] Challenge status: "${title}"`);
    }

    const html = await page.content().catch(() => '');
    const cookies = await page.cookies().catch(() => []);
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => fingerprint.navigator.userAgent);

    const hasCfClearance = cookies.some(c => c.name === 'cf_clearance');
    console.log(`[CFBypass] cf_clearance: ${hasCfClearance}, cookies: ${cookies.length}, html: ${html.length} bytes`);

    // Cache valid session
    const sessionData = { html, cookies, userAgent, expiresAt: Date.now() + CACHE_TTL_MS };
    sessionCache.set(domain, sessionData);

    return { html, cookies, userAgent, success: true, fromCache: false, cfCleared: hasCfClearance };

  } catch (err) {
    console.error(`[CFBypass] Error: ${err.message}`);
    return { html: '', cookies: [], userAgent: '', success: false, error: err.message };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
}

/**
 * Advanced Evasions (rebrowser-patches pattern):
 * Strips CDP artifacts, ChromeDriver cdc_ markers, and cleans stack traces.
 */
async function applyAdvancedEvasions(page) {
  await page.evaluateOnNewDocument(() => {
    // 1. Remove webdriver property and make it indistinguishable
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 2. Remove cdc_ and $cdc_ automation variables
    for (const prop of Object.getOwnPropertyNames(window)) {
      if (prop.includes('cdc_') || prop.includes('$cdc_')) {
        delete window[prop];
      }
    }

    // 3. Emulate genuine Chrome runtime object
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        connect: function () {},
        sendMessage: function () {}
      };
    }

    // 4. Clean error stack traces from automation signatures
    const originalError = Error;
    const cleanStack = (stack) => {
      if (typeof stack !== 'string') return stack;
      return stack.split('\n').filter(line => !line.includes('puppeteer') && !line.includes('rebrowser')).join('\n');
    };

    window.Error = function (...args) {
      const err = new originalError(...args);
      if (err.stack) err.stack = cleanStack(err.stack);
      return err;
    };
    window.Error.prototype = originalError.prototype;

    // 5. Spoof permissions query
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });
}

/**
 * Human-like mouse movement using cubic bezier interpolation.
 */
async function humanMouseMove(page, startX, startY, endX, endY, steps = 18) {
  const p1x = startX + (Math.random() - 0.5) * 50;
  const p1y = startY + (Math.random() - 0.5) * 50;
  const p2x = endX + (Math.random() - 0.5) * 50;
  const p2y = endY + (Math.random() - 0.5) * 50;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(
      Math.pow(1 - t, 3) * startX +
      3 * Math.pow(1 - t, 2) * t * p1x +
      3 * (1 - t) * Math.pow(t, 2) * p2x +
      Math.pow(t, 3) * endX
    );
    const y = Math.round(
      Math.pow(1 - t, 3) * startY +
      3 * Math.pow(1 - t, 2) * t * p1y +
      3 * (1 - t) * Math.pow(t, 2) * p2y +
      Math.pow(t, 3) * endY
    );
    await page.mouse.move(x, y);
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 8) + 4));
  }
}

/**
 * Detects Turnstile iframe and simulates natural human interaction.
 */
async function trySolveTurnstileChallenge(page) {
  try {
    await new Promise(r => setTimeout(r, 2000));
    const iframes = await page.$$('iframe');
    for (const frame of iframes) {
      const src = await page.evaluate(el => el.getAttribute('src') || '', frame);
      if (src.includes('cloudflare') || src.includes('turnstile') || src.includes('challenges')) {
        const box = await frame.boundingBox();
        if (box) {
          console.log(`[CFBypass] Turnstile challenge frame detected at (${Math.round(box.x)}, ${Math.round(box.y)})`);
          const targetX = box.x + 28 + Math.floor(Math.random() * 10);
          const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 6;

          // Natural mouse move from random position
          await humanMouseMove(page, 100, 100, targetX, targetY);
          await page.mouse.down();
          await new Promise(r => setTimeout(r, Math.floor(Math.random() * 70) + 60));
          await page.mouse.up();
          console.log(`[CFBypass] Turnstile interaction sent.`);
          return;
        }
      }
    }
  } catch (e) {
    // Challenge iframe not present or already resolved
  }
}

/**
 * Poll page title until it's no longer a Cloudflare challenge page.
 */
async function waitForChallengeCleared(page, timeoutMs = 30000) {
  const cfTitles = ['just a moment', 'attention required', 'please wait', 'one more step', 'checking your browser'];
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const title = await page.title();
      const isCfPage = cfTitles.some(t => title.toLowerCase().includes(t));
      if (!isCfPage && title.length > 0) return true;
    } catch (e) { /* page may be navigating */ }
    await new Promise(r => setTimeout(r, 800));
  }
  return false;
}

/**
 * Format cookies array into a Cookie header string.
 */
function cookiesToHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/**
 * Find the Chrome/Edge executable path on Windows.
 */
function findChromePath() {
  const fs = require('fs');
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const paths = [
    `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
    `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${programFiles86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${programFiles86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
  ];
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Clear a specific domain's session cache (e.g., after IP rotation).
 */
function clearSessionCache(domain) {
  if (domain) {
    sessionCache.delete(domain);
    console.log(`[CFBypass] Cache cleared for ${domain}`);
  } else {
    sessionCache.clear();
    console.log(`[CFBypass] All session cache cleared`);
  }
}

module.exports = { solveCloudflarePage, cookiesToHeader, clearSessionCache };

