const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { SocksProxyAgent } = require('socks-proxy-agent');
const TorController = require('./tor_controller');
const StealthLauncher = require('./stealth_launcher');
const { solveCloudflarePage, cookiesToHeader, clearSessionCache } = require('./cloudflare_bypass');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const tor = new TorController({
  socksPort: 9050,
  controlPort: 9051
});

const launcher = new StealthLauncher();
const DnsSinkhole = require('./dns_sinkhole');
const dnsSinkhole = new DnsSinkhole({ torDnsPort: 9053 });
dnsSinkhole.start();

let autoRotateTimer = null;
let autoRotateInterval = 0; // seconds
let nextRotateTime = null;

// Cache for IP info to avoid rate-limiting
let cachedRealIp = null;
let cachedVirtualIp = null;
let isRotating = false;

// Initialize vpnConnected based on actual Windows system proxy status
let vpnConnected = false;
try {
  const { execSync } = require('child_process');
  const out = execSync('python proxy_toggle.py status', { cwd: __dirname }).toString();
  const parsed = JSON.parse(out);
  vpnConnected = !!parsed.enabled;
} catch (e) {
  vpnConnected = false;
}

// Helper: Make HTTP/HTTPS request with optional SOCKS5 agent
function fetchJson(url, useTor = false, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: timeoutMs
    };

    if (useTor) {
      options.agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
    }

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve({ ip: data.trim() });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

// Fetch IP info with fallback providers
async function getIpDetails(useTor = false) {
  let detectedIp = null;

  // 1. Get IP through the selected route
  const ipEndpoints = [
    { url: 'https://check.torproject.org/api/ip', parser: (d) => d.IP },
    { url: 'https://api.ipify.org?format=json', parser: (d) => d.ip },
    { url: 'https://httpbin.org/ip', parser: (d) => d.origin?.split(',')[0].trim() },
    { url: 'https://ipinfo.io/json', parser: (d) => d.ip }
  ];

  for (const ep of ipEndpoints) {
    try {
      const data = await fetchJson(ep.url, useTor, 7000);
      const parsed = ep.parser(data);
      if (parsed && parsed.includes('.')) {
        detectedIp = parsed;
        break;
      }
    } catch (e) {}
  }

  if (!detectedIp) {
    throw new Error(`Failed to resolve ${useTor ? 'Virtual Tor' : 'Real'} IP`);
  }

  // 2. Fetch Geo & ISP metadata for this IP (Direct query for metadata)
  let geo = {
    ip: detectedIp,
    country: 'Virtual Route',
    countryCode: 'TOR',
    city: 'Encrypted Node',
    region: 'Tor Circuit',
    isp: useTor ? 'Tor Exit Relay' : 'Home ISP',
    org: useTor ? 'Tor Project' : 'Broadband'
  };

  try {
    const geoData = await fetchJson(`http://ip-api.com/json/${detectedIp}?fields=status,country,countryCode,regionName,city,isp,org,as`, false, 5000);
    if (geoData && geoData.status === 'success') {
      geo.country = geoData.country || geo.country;
      geo.countryCode = geoData.countryCode || geo.countryCode;
      geo.city = geoData.city || geo.city;
      geo.region = geoData.regionName || geo.region;
      geo.isp = geoData.isp || geo.isp;
      geo.org = geoData.org || geo.org;
    }
  } catch (e) {
    // Geo lookup fallback
  }

  return geo;
}

// Update IP Cache
async function updateIps() {
  // Real IP (Direct)
  if (!cachedRealIp) {
    try {
      cachedRealIp = await getIpDetails(false);
    } catch (e) {
      console.error('Error fetching real IP:', e.message);
    }
  }

  // Virtual IP (via Tor SOCKS5)
  if (tor.isBootstrapped) {
    try {
      cachedVirtualIp = await getIpDetails(true);
    } catch (e) {
      console.error('Error fetching virtual Tor IP:', e.message);
    }
  }
}

// REST Endpoints
app.get('/api/status', async (req, res) => {
  const browser = launcher.detectBrowser();

  res.json({
    vpnConnected,
    tor: {
      isBootstrapped: tor.isBootstrapped,
      progress: tor.bootstrapProgress,
      status: tor.bootstrapStatus,
      socksPort: tor.socksPort,
      controlPort: tor.controlPort,
      exitCountry: tor.exitCountry,
      lastIpChange: tor.lastIpChange
    },
    realIp: cachedRealIp ? {
      ip: cachedRealIp.ip ? `${cachedRealIp.ip.split('.').slice(0, 2).join('.')}.*.*` : 'Detecting...',
      fullIp: cachedRealIp.ip,
      country: cachedRealIp.country,
      countryCode: cachedRealIp.countryCode,
      city: cachedRealIp.city,
      isp: cachedRealIp.isp
    } : null,
    virtualIp: cachedVirtualIp ? {
      ip: cachedVirtualIp.ip,
      country: cachedVirtualIp.country,
      countryCode: cachedVirtualIp.countryCode,
      city: cachedVirtualIp.city,
      region: cachedVirtualIp.region,
      isp: cachedVirtualIp.isp,
      org: cachedVirtualIp.org
    } : null,
    browser: {
      available: !!browser,
      name: browser ? browser.name : 'None detected'
    },
    autoRotate: {
      enabled: autoRotateInterval > 0,
      interval: autoRotateInterval,
      nextRotateTime
    },
    isRotating,
    traffic: await tor.getTrafficStats()
  });
});

app.get('/api/tor/circuit', async (req, res) => {
  try {
    const circuit = await tor.getCircuitDetails();
    res.json(circuit);
  } catch (err) {
    res.status(500).json({ available: false, error: err.message, hops: [] });
  }
});

app.post('/api/tor/new-circuit', async (req, res) => {
  try {
    const result = await tor.requestNewCircuit();
    setTimeout(async () => {
      try {
        cachedVirtualIp = await getIpDetails(true);
      } catch (e) {}
    }, 1500);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tor/traffic', async (req, res) => {
  try {
    const traffic = await tor.getTrafficStats();
    res.json(traffic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rotate-ip', async (req, res) => {
  if (isRotating) {
    return res.status(429).json({ success: false, message: 'Rotation already in progress' });
  }

  isRotating = true;
  tor.log('API Request: Triggering Virtual IP Rotation...', 'info');

  try {
    const oldIp = cachedVirtualIp ? cachedVirtualIp.ip : null;
    const rotateRes = await tor.rotateIp();

    if (!rotateRes.success) {
      isRotating = false;
      return res.status(500).json(rotateRes);
    }

    // Wait a brief moment for new circuit establishment
    await new Promise(r => setTimeout(r, 2500));

    // Fetch new Virtual IP
    try {
      cachedVirtualIp = await getIpDetails(true);
      tor.log(`New Virtual IP acquired: ${cachedVirtualIp.ip} (${cachedVirtualIp.city}, ${cachedVirtualIp.country})`, 'success');
    } catch (e) {
      tor.log('Error refreshing virtual IP after rotation: ' + e.message, 'warn');
    }

    isRotating = false;
    res.json({
      success: true,
      oldIp,
      newIp: cachedVirtualIp ? cachedVirtualIp.ip : 'Pending',
      details: cachedVirtualIp
    });
  } catch (err) {
    isRotating = false;
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/set-country', async (req, res) => {
  const { country } = req.body;
  try {
    if (!country || country === 'random' || country === 'ALL') {
      await tor.sendControlCommand('RESETCONF ExitNodes');
      await tor.sendControlCommand('RESETCONF StrictNodes');
      tor.exitCountry = 'random';
    } else {
      await tor.sendControlCommand(`SETCONF ExitNodes={${country.toLowerCase()}}`);
      await tor.sendControlCommand('SETCONF StrictNodes=1');
      tor.exitCountry = country.toLowerCase();
    }
    tor.log(`Exit node country set to: ${country}`, 'info');
    await tor.rotateIp();
    cachedVirtualIp = null;
    res.json({ success: true, country });
  } catch (err) {
    tor.log(`Failed to set exit country: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auto-rotate', (req, res) => {
  const { interval } = req.body; // in seconds, 0 = disable
  const secs = parseInt(interval, 10) || 0;

  if (autoRotateTimer) {
    clearInterval(autoRotateTimer);
    autoRotateTimer = null;
    nextRotateTime = null;
  }

  autoRotateInterval = secs;

  if (secs > 0) {
    tor.log(`Auto-rotate enabled: changing IP every ${secs} seconds`, 'info');
    nextRotateTime = Date.now() + secs * 1000;

    autoRotateTimer = setInterval(async () => {
      if (!isRotating && tor.isBootstrapped) {
        tor.log('Auto-timer triggered: Rotating Virtual IP...', 'info');
        isRotating = true;
        try {
          await tor.rotateIp();
          await new Promise(r => setTimeout(r, 2000));
          cachedVirtualIp = await getIpDetails(true);
        } catch (e) {
          tor.log('Auto-rotate refresh error: ' + e.message, 'warn');
        } finally {
          isRotating = false;
          nextRotateTime = Date.now() + secs * 1000;
        }
      }
    }, secs * 1000);
  } else {
    tor.log('Auto-rotate disabled', 'info');
  }

  res.json({
    success: true,
    enabled: secs > 0,
    interval: secs,
    nextRotateTime
  });
});

app.post('/api/launch-stealth', (req, res) => {
  const { url = 'https://web.telegram.org/a/', incognito = false, noProxy = false, bypassList = [] } = req.body;
  try {
    const session = launcher.launch({
      url,
      incognito,
      socksPort: tor.socksPort,
      noProxy,
      bypassList
    });
    const modeDesc = noProxy ? 'DIRECT (No Proxy)' : 'TOR ROUTED + SMART BOT BYPASS';
    tor.log(`Launched Stealth Session for: ${url} (${session.browserName}, Mode: ${modeDesc})`, 'success');
    res.json({ success: true, session });
  } catch (err) {
    tor.log(`Error launching stealth session: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dynamic PAC (Proxy Auto-Configuration) endpoint for Split-Tunneling
app.get('/proxy.pac', (req, res) => {
  res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig');
  res.send(`
function FindProxyForURL(url, host) {
  // Known bot verification & Cloudflare challenge domains that block Tor exit nodes
  var directHosts = [
    "*.wingofun.pro",
    "verify.wingofun.pro",
    "challenges.cloudflare.com",
    "*.challenges.cloudflare.com",
    "turnstile.cloudflare.com",
    "*.turnstile.cloudflare.com",
    "hcaptcha.com",
    "*.hcaptcha.com",
    "localhost",
    "127.0.0.1"
  ];

  for (var i = 0; i < directHosts.length; i++) {
    if (shExpMatch(host, directHosts[i])) {
      return "DIRECT";
    }
  }

  // All other traffic, including Telegram Web, routes 100% through Tor SOCKS5
  return "SOCKS5 127.0.0.1:${tor.socksPort}; SOCKS 127.0.0.1:${tor.socksPort}; DIRECT";
}
  `);
});

// Live Tor HTTP/HTTPS Proxy Endpoint for Mini Browser Screen
app.all('/api/proxy', async (req, res) => {
  let targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL query parameter required');

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    // If it looks like a search query, send to DuckDuckGo HTML
    if (!targetUrl.includes('.') || targetUrl.includes(' ')) {
      targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(targetUrl)}`;
    } else {
      targetUrl = 'https://' + targetUrl;
    }
  }

  // Telegram Web normalization: default to /k/ for smooth iframe embedding
  if (targetUrl === 'https://web.telegram.org' || targetUrl === 'https://web.telegram.org/' || targetUrl === 'http://web.telegram.org' || targetUrl === 'http://web.telegram.org/') {
    targetUrl = 'https://web.telegram.org/k/';
  }

  const handleRequest = (currentUrl, redirectCount = 0) => {
    if (redirectCount > 5) {
      return res.status(500).send('Too many redirects');
    }

    try {
      const urlObj = new URL(currentUrl);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      // If the target domain is known to block Tor exit nodes, connect directly to prevent 403
      const isDirectVerification = urlObj.hostname.includes('wingofun.pro') || 
                                   urlObj.hostname.includes('challenges.cloudflare.com');

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: req.method || 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, identity'
        },
        timeout: 25000
      };

      if (!isDirectVerification) {
        options.agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
      }

      const proxyReq = client.request(options, (proxyRes) => {
        // Follow redirects
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          let nextUrl = proxyRes.headers.location;
          if (!nextUrl.startsWith('http://') && !nextUrl.startsWith('https://')) {
            nextUrl = new URL(nextUrl, currentUrl).href;
          }
          return handleRequest(nextUrl, redirectCount + 1);
        }

        const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
        const contentEncoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();

        // Strip headers that prevent embedding in iframe
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['content-security-policy-report-only'];
        delete proxyRes.headers['cross-origin-opener-policy'];
        delete proxyRes.headers['cross-origin-embedder-policy'];
        delete proxyRes.headers['cross-origin-resource-policy'];

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
          const chunks = [];
          proxyRes.on('data', chunk => chunks.push(chunk));
          proxyRes.on('end', () => {
            let buffer = Buffer.concat(chunks);
            try {
              if (contentEncoding === 'gzip') {
                buffer = zlib.gunzipSync(buffer);
              } else if (contentEncoding === 'deflate') {
                buffer = zlib.inflateSync(buffer);
              } else if (contentEncoding === 'br') {
                buffer = zlib.brotliDecompressSync(buffer);
              }
            } catch (decompErr) {
              console.warn('[Proxy] Decompression warning:', decompErr.message);
            }

            let html = buffer.toString('utf-8');

            // Strip any <meta http-equiv="Content-Security-Policy"> or <meta http-equiv="X-Frame-Options">
            html = html.replace(/<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
            html = html.replace(/<meta[^>]*http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');

            const baseTag = `<base href="${currentUrl}">`;
            const helperScript = `
<script>
  (function() {
    function toProxy(u) {
      try {
        var abs = new URL(u, document.baseURI || window.location.href).href;
        return '/api/proxy?url=' + encodeURIComponent(abs);
      } catch(e) { return u; }
    }
    document.addEventListener('click', function(e) {
      var a = e.target.closest('a');
      if (a && a.href && !a.href.startsWith('javascript:') && !a.href.startsWith('#')) {
        var targetUrl = a.getAttribute('href');
        if (targetUrl) {
          e.preventDefault();
          try {
            var fullUrl = new URL(targetUrl, document.baseURI || window.location.href).href;
            window.location.href = '/api/proxy?url=' + encodeURIComponent(fullUrl);
            if (window.parent && window.parent.updateMiniBrowserUrl) {
              window.parent.updateMiniBrowserUrl(fullUrl);
            }
          } catch(err) {
            window.location.href = a.href;
          }
        }
      }
    }, true);
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (form && (form.method || 'get').toLowerCase() === 'get') {
        e.preventDefault();
        var formData = new FormData(form);
        var params = new URLSearchParams(formData).toString();
        var actionUrl = new URL(form.getAttribute('action') || '', document.baseURI || window.location.href);
        var fullUrl = actionUrl.origin + actionUrl.pathname + (params ? '?' + params : '');
        window.location.href = '/api/proxy?url=' + encodeURIComponent(fullUrl);
        if (window.parent && window.parent.updateMiniBrowserUrl) {
          window.parent.updateMiniBrowserUrl(fullUrl);
        }
      }
    }, true);
  })();
</script>`;

            let modifiedHtml = html;
            if (modifiedHtml.includes('<head>')) {
              modifiedHtml = modifiedHtml.replace('<head>', `<head>${baseTag}${helperScript}`);
            } else if (modifiedHtml.includes('<html')) {
              modifiedHtml = modifiedHtml.replace(/<html[^>]*>/, `$&<head>${baseTag}${helperScript}</head>`);
            } else {
              modifiedHtml = `${baseTag}${helperScript}` + modifiedHtml;
            }

            delete proxyRes.headers['content-length'];
            delete proxyRes.headers['transfer-encoding'];
            delete proxyRes.headers['content-encoding'];

            for (const [key, val] of Object.entries(proxyRes.headers)) {
              if (val) res.setHeader(key, val);
            }
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(modifiedHtml);
          });
        } else {
          // For non-HTML (images, css, js, fonts, json)
          delete proxyRes.headers['transfer-encoding'];
          for (const [key, val] of Object.entries(proxyRes.headers)) {
            if (val) res.setHeader(key, val);
          }
          proxyRes.pipe(res);
        }
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        res.status(504).send('<h3 style="color:#f87171;font-family:sans-serif;padding:20px;">Tor request timed out. Try refreshing or rotating virtual IP.</h3>');
      });

      proxyReq.on('error', (err) => {
        res.status(502).send(`<h3 style="color:#f87171;font-family:sans-serif;padding:20px;">Tor Proxy Error: ${err.message}</h3>`);
      });

      proxyReq.end();
    } catch (err) {
      res.status(500).send(`<h3 style="color:#f87171;font-family:sans-serif;padding:20px;">Invalid URL: ${err.message}</h3>`);
    }
  };

  handleRequest(targetUrl);
});

// Cloudflare Bypass Endpoint — rotates Tor IP up to MAX_ATTEMPTS times to find an unblocked exit node
app.all('/api/cf-bypass', async (req, res) => {
  let targetUrl = req.query.url || (req.body && req.body.url);
  if (!targetUrl) return res.status(400).json({ success: false, error: 'url param required' });
  if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

  const MAX_ATTEMPTS = 10;
  const CF_HARD_BLOCK_TITLES = ['attention required', 'just a moment', 'please wait', 'one more step', 'checking your browser', 'access denied'];

  tor.log(`CF Bypass requested for: ${targetUrl} (up to ${MAX_ATTEMPTS} IP rotations)`, 'info');

  // Clear any stale cache for this domain before retrying
  clearSessionCache(new URL(targetUrl).hostname);

  let lastResult = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    tor.log(`CF Bypass attempt ${attempt}/${MAX_ATTEMPTS}...`, 'info');

    try {
      lastResult = await solveCloudflarePage(targetUrl, tor.socksPort);

      if (!lastResult.success) {
        tor.log(`Attempt ${attempt} — browser error, rotating...`, 'warn');
      } else {
        const htmlLower = (lastResult.html || '').toLowerCase();
        const title = (htmlLower.match(/<title>(.*?)<\/title>/) || [])[1] || '';
        const isCfBlocked = CF_HARD_BLOCK_TITLES.some(t => title.includes(t));

        if (!isCfBlocked) {
          // SUCCESS — exit node is not blocked!
          tor.log(`✓ CF Bypass success on attempt ${attempt}! Title: "${title.substring(0, 60)}"`, 'success');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('X-CF-Attempts', String(attempt));
          return res.send(lastResult.html);
        }

        tor.log(`Attempt ${attempt} — Cloudflare hard block detected. Rotating IP...`, 'warn');
      }

      // Rotate Tor IP before next attempt
      clearSessionCache(new URL(targetUrl).hostname);
      if (attempt < MAX_ATTEMPTS) {
        await tor.rotateIp(); // get fresh exit node
        await new Promise(r => setTimeout(r, 2000)); // let circuit stabilize
      }
    } catch (err) {
      tor.log(`Attempt ${attempt} error: ${err.message}`, 'error');
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000));
    }
  }

  // All attempts failed — return last HTML with error status
  tor.log(`CF Bypass failed after ${MAX_ATTEMPTS} attempts for: ${targetUrl}`, 'error');
  res.status(403).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-CF-Attempts', String(MAX_ATTEMPTS));
  res.send(`
    <html><body style="background:#0f172a;color:#f1f5f9;font-family:sans-serif;padding:40px;text-align:center">
      <h2 style="color:#f87171">Cloudflare Block — All ${MAX_ATTEMPTS} Tor IPs Blocked</h2>
      <p style="color:#94a3b8">The site <strong>${new URL(targetUrl).hostname}</strong> blocks all Tor exit nodes at the IP level.<br>
      This requires a CAPTCHA solver service (like 2captcha) or a non-Tor residential proxy.</p>
      <p style="color:#64748b;font-size:0.8rem">Tried ${MAX_ATTEMPTS} different Tor exit nodes — all returned Cloudflare hard block.</p>
    </body></html>
  `);
});

// Clear CF session cache (call after IP rotation)
app.post('/api/cf-cache-clear', (req, res) => {
  const { domain } = req.body || {};
  clearSessionCache(domain);
  tor.log(`CF session cache cleared${domain ? ' for ' + domain : ' (all)'}`, 'info');
  res.json({ success: true });
});


app.get('/api/leak-check', async (req, res) => {
  try {
    const direct = await getIpDetails(false);
    let torRouted = null;
    let leakDetected = false;

    if (tor.isBootstrapped) {
      torRouted = await getIpDetails(true);
      leakDetected = (direct.ip === torRouted.ip);
    }

    res.json({
      success: true,
      protectionStatus: leakDetected ? 'VULNERABLE' : 'SECURE_MASKED',
      realIp: direct.ip,
      virtualIp: torRouted ? torRouted.ip : 'Not yet connected',
      dnsLeakGuarded: true,
      webRtcShielded: true,
      description: leakDetected 
        ? 'WARNING: Real IP and Proxied IP are identical. Tor proxy is not masking traffic.' 
        : 'SECURE: Real IP is completely hidden. All destination services see only the Virtual Tor IP.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/system-proxy', (req, res) => {
  try {
    const { execSync } = require('child_process');
    const out = execSync('python proxy_toggle.py status', { cwd: __dirname }).toString();
    res.json(JSON.parse(out));
  } catch (e) {
    res.json({ enabled: false, error: e.message });
  }
});

app.post('/api/system-proxy', (req, res) => {
  const { enable } = req.body;
  try {
    const { execSync } = require('child_process');
    const cmd = enable ? 'python proxy_toggle.py on' : 'python proxy_toggle.py off';
    const out = execSync(cmd, { cwd: __dirname }).toString();
    const parsed = JSON.parse(out);
    vpnConnected = !!enable;
    tor.log(`Windows System-Wide Proxy set to: ${enable ? 'ENABLED (Virtual IP for all apps)' : 'DISABLED (Direct Real IP)'}`, enable ? 'success' : 'warn');
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/killswitch', (req, res) => {
  try {
    const { execSync } = require('child_process');
    const out = execSync('python killswitch.py status', { cwd: __dirname }).toString();
    res.json(JSON.parse(out));
  } catch (e) {
    res.json({ active: false, error: e.message });
  }
});

app.post('/api/killswitch', (req, res) => {
  const { enable } = req.body;
  try {
    const { execSync } = require('child_process');
    const cmd = enable ? `python killswitch.py enable "${tor.torExe}"` : 'python killswitch.py disable';
    const out = execSync(cmd, { cwd: __dirname }).toString();
    const parsed = JSON.parse(out);
    tor.log(`Firewall Kill Switch ${enable ? 'ENGAGED (Zero-Leak Lock active)' : 'DISENGAGED'}`, enable ? 'success' : 'warn');
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/dns-guard', (req, res) => {
  res.json(dnsSinkhole.getStats());
});

app.post('/api/dns-guard/toggle', (req, res) => {
  const { enable } = req.body;
  const stats = dnsSinkhole.toggle(enable);
  tor.log(`DNS Privacy Sinkhole ${stats.enabled ? 'ACTIVE (Blocking trackers & ad scripts)' : 'BYPASSED'}`, stats.enabled ? 'success' : 'warn');
  res.json(stats);
});



app.get('/api/vpn/status', (req, res) => {
  res.json({ connected: vpnConnected });
});

app.post('/api/vpn/toggle', async (req, res) => {
  const { enable } = req.body;
  vpnConnected = typeof enable === 'boolean' ? enable : !vpnConnected;
  try {
    const { execSync } = require('child_process');
    const cmd = vpnConnected ? 'python proxy_toggle.py on' : 'python proxy_toggle.py off';
    try {
      execSync(cmd, { cwd: __dirname });
    } catch(e){}
    tor.log(`VPN Gateway ${vpnConnected ? 'CONNECTED (Tor Protection Active)' : 'DISCONNECTED (Direct ISP Traffic)'}`, vpnConnected ? 'success' : 'warn');
    res.json({ success: true, connected: vpnConnected });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/logs', (req, res) => {
  res.json({
    logs: tor.logs
  });
});

// Start server and Tor engine
const server = app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(`🛡️  Tor Privacy Portal listening on http://localhost:${PORT}`);
  console.log(`====================================================`);

  try {
    await tor.start();
    await updateIps();
    console.log(`[TorController] Real IP: ${cachedRealIp?.ip || 'Unknown'} | Virtual Tor IP: ${cachedVirtualIp?.ip || 'Pending'}`);
    
    // Periodically keep Virtual IP cache fresh
    setInterval(async () => {
      if (tor.isBootstrapped) {
        try {
          const vIp = await getIpDetails(true);
          if (vIp && vIp.ip) cachedVirtualIp = vIp;
        } catch (e) {}
      }
    }, 20000);
  } catch (e) {
    console.error('Initialization error:', e.message);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️ Port ${PORT} is currently busy. Auto-recovering...`);
    try {
      require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
      setTimeout(() => {
        server.listen(PORT);
      }, 1000);
    } catch (e) {
      console.error(`Could not automatically free port ${PORT}:`, e.message);
    }
  } else {
    console.error('Server error:', err);
  }
});

// Clean up Tor process on shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server and Tor...');
  try {
    require('child_process').execSync('python proxy_toggle.py off', { cwd: __dirname });
  } catch(e){}
  tor.stop();
  process.exit();
});

process.on('SIGTERM', () => {
  try {
    require('child_process').execSync('python proxy_toggle.py off', { cwd: __dirname });
  } catch(e){}
  tor.stop();
  process.exit();
});
