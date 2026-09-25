# GhostShield Core Repositories Integration Plan

> **Goal:** Transform GhostShield from a basic browser proxy into an enterprise-grade Anonymous Security Suite with hardware-level network tunneling, anti-detect browser evasion, and kernel protection.

---

## Phase 1: `apify/fingerprint-suite` & `rebrowser-patches` (God-Mode Anti-Detect & Cloudflare Evasion)

### Problem Being Solved
Standard Puppeteer/Chromium instances leak low-level signatures:
- `Runtime.enable` and `Target.setAutoAttach` leaks that Cloudflare Turnstile & DataDome immediately catch.
- Default headless Canvas, WebGL, AudioContext, Font lists, and Screen geometry which are flagged as automated bots.

### Technical Architecture
- **Repository 1:** [`rebrowser/rebrowser-patches`](https://github.com/rebrowser/rebrowser-patches) or patched Puppeteer Core to strip CDP debugger artifacts and `cdc_` string markers.
- **Repository 2:** [`apify/fingerprint-suite`](https://github.com/apify/fingerprint-suite) (`fingerprint-generator` & `fingerprint-injector`) to inject real-world device signatures (real hardware concurrency, real audio buffer variance, canvas noise, dynamic WebGL unmasked vendor/renderer).
- **Core Module Updates:**
  - `cloudflare_bypass.js`: Integrate statistical fingerprint injection and Turnstile challenge solver loop.
  - `stealth_launcher.js`: Apply evasions and profile isolation.

### Execution Steps
1. Install `fingerprint-generator` and `fingerprint-injector` via npm.
2. In `cloudflare_bypass.js`, generate randomized yet mathematically coherent fingerprints (Windows 10/11, Chrome 128+, matching screen resolution, WebGL vendor Google Inc./NVIDIA, audio latency).
3. Inject evasions before any page script executes (`page.evaluateOnNewDocument`).
4. Implement automatic Cloudflare checkbox frame detector and human-like cursor bezier curve movement.
5. Verification: Test against `https://nowsecure.nl`, `https://bot.sannysoft.com`, and `https://cloudflare.manfredi.io/en/`.

---

## Phase 2: Hardware Firewall Kill Switch (`netsh advfirewall` / WFP)

### Problem Being Solved
If Tor crashes or network glitches occur, the system reverts to direct ISP connection for milliseconds or seconds, exposing the real identity.

### Technical Architecture
- Creates two Windows Firewall rules:
  1. **Block-All-Outbound Rule:** Drops any outbound network packet on all network adapters.
  2. **Allow-Tor Rule:** Permits outbound connections ONLY for `tor.exe` and `localhost (127.0.0.1)`.
- If Tor goes down, the entire computer's internet instantly dies until Tor reconnects or user clicks Disconnect.

### Execution Steps
1. Create `killswitch.py` / `killswitch.js` using Windows Netsh / PowerShell firewall commands.
2. Hook into `TorController` process health monitor (`this.process.on('close')`).
3. Add emergency restoration routine (`killswitch.disable()`) on graceful exit and unhandled exception handlers.

---

## Phase 3: `xjasonlyu/tun2socks` + `wintun` (True 100% Kernel-Level System VPN)

### Problem Being Solved
Windows Registry (WinINet) proxy only routes web browsers and apps honoring system HTTP/SOCKS settings.
- Command Prompt, PowerShell, Git, Node.js scripts, Discord, Steam, games, and background services bypass the proxy and leak real ISP IP (`111.125.225.127`).
- UDP packets and direct socket connections are not captured.

### Technical Architecture
- **Repository:** [`xjasonlyu/tun2socks`](https://github.com/xjasonlyu/tun2socks) + [`WireGuard/wintun`](https://www.wintun.net/)
- Creates a virtual Network Interface Card (NIC) `GhostShield-TUN` on Windows.
- Configures default IP routing table: all IPv4 traffic (`0.0.0.0/0`) is directed into the TUN adapter.
- `tun2socks.exe` reads raw IP packets from the TUN adapter, translates TCP/UDP/DNS to SOCKS5 protocol, and sends them to Tor on `127.0.0.1:9050`.

### Execution Steps
1. Add standalone portable `wintun.dll` and `tun2socks-windows-amd64.exe` to a dedicated `bin/` directory.
2. Create `tun_controller.js`:
   - Spawns `tun2socks.exe -device wintun -proxy socks5://127.0.0.1:9050 -interface GhostShield-TUN`.
   - Modifies Windows route table via PowerShell: `route add 127.0.0.1 ...`, `route add 0.0.0.0 mask 0.0.0.0 <tun_gateway>`.
3. Auto-fallback to WinINet if administrator privileges are not granted.
4. Verification: Test `curl.exe` and `ping.exe` from standard Command Prompt to confirm 100% routing through Tor without browser proxy.

---

## Phase 4: Local DNS Sinkhole & Ad/Tracker Blocker (Pi-hole / AdGuard Core for Tor)

### Problem Being Solved
Tor can be slow because advertising scripts, tracking pixels, telemetry, and heavy analytics transfer megabytes over high-latency onion circuits.

### Technical Architecture
- Lightweight local DNS forwarder listening on `127.0.0.1:53` (or intercepting DNS via Tor `DNSPort 9053`).
- Maintains an in-memory Trie/Bloom Filter of 80,000+ ad and tracking domains (EasyList / Peter Lowe list).
- Returns `0.0.0.0` instantly for blocked domains; forwards valid queries to Tor `DNSPort`.
- Accelerates Tor page load times by up to 2.5x and saves 35-45% bandwidth.

---

## Roadmap & Execution Priority

| Order | Core Feature / Repo | Core Impact | Complexity |
|---|---|---|---|
| **Step 1** | **`fingerprint-suite` + Anti-Detect Engine** | Cloudflare/Turnstile 100% Bypass & undetectable stealth browser | Medium |
| **Step 2** | **Firewall Fail-Safe Kill Switch** | Absolute zero leak protection against crashes | Low-Medium |
| **Step 3** | **`tun2socks` + `wintun` System VPN** | 100% of PC apps (CMD, games, apps) forced through Tor | High |
| **Step 4** | **DNS Ad & Telemetry Sinkhole** | 2.5x Faster Tor browsing speed & reduced data load | Medium |
