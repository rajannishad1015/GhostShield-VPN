<div align="center">

<img src="public/logo.png" alt="GhostShield Logo" width="140" style="border-radius: 24px; margin-bottom: 12px;"/>

# GhostShield VPN
### Enterprise Defense-Grade Tor Privacy Gateway, Zero-Leak Firewall Kill Switch & Anti-Detect Sandbox

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg?style=for-the-badge)](https://github.com/rajannishad1015/GhostShield-VPN)
[![Tor](https://img.shields.io/badge/Tor_Core-0.4.9.11-7D4698.svg?style=for-the-badge&logo=torproject)](https://www.torproject.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-0078D6.svg?style=for-the-badge)](https://github.com/rajannishad1015/GhostShield-VPN)
[![Security](https://img.shields.io/badge/Zero--Leak-WFP%20%2B%20DNS%20Shield-critical.svg?style=for-the-badge)](#security-architecture)

<p align="center">
  <b>GhostShield</b> is an enterprise-grade network security gateway and privacy orchestration suite. It bridges low-level Onion v3 multi-hop routing, Windows kernel-level firewall enforcement, automated proxy management, and anti-fingerprint browser sandboxing into a unified, high-performance command console.
</p>

[Key Features](#-core-capabilities) • [Architecture](#-system-architecture) • [Quick Start](#-quick-start) • [API Reference](#-api-endpoints) • [Threat Model](#-threat-model--zero-leak-guarantees) • [License](#-license)

---

</div>

## 📌 Executive Summary

Traditional VPN services rely on centralized exit servers, commercial certificate trust, and proprietary log policies. **GhostShield** enforces decentralized, trustless, zero-knowledge routing powered by the official Tor protocol combined with host-level defensive boundaries:

- **Decentralized 3-Hop Circuits:** No single relay in the chain knows both your identity and destination.
- **Dual-Tier Zero-Leak Kill Switch:** Hardware-level blackholing via Windows Filtering Platform (`netsh advfirewall`) with graceful userspace socket interdiction fallback.
- **Remote Host DNS Enforcement:** Universal DNS sinkholing preventing ISP-level UDP 53 snooping.
- **Stealth Anti-Detect Engine:** Real-time canvas/WebGL/audio fingerprint injection and CDP leak suppression for automated and interactive browsing.

---

## 🏗 System Architecture

```
+---------------------------------------------------------------------------------------+
|                                    LOCAL MACHINE                                      |
|                                                                                       |
|   [ Browser / Apps ]        [ Telegram / CLI ]        [ Stealth Browser Sandbox ]     |
|          |                         |                               |                  |
|          +-------------------------+-------------------------------+                  |
|                                    |                                                  |
|                        Windows Registry / System Proxy                                |
|                        (Auto-Config: 127.0.0.1:9080)                                  |
|                                    |                                                  |
|               +--------------------+---------------------+                            |
|               |  GHOSTSHIELD GATEWAY ENGINE (PORT 3000)   |                            |
|               |  - Express REST & Real-Time Telemetry    |                            |
|               |  - Dual-Tier Zero-Leak Kill Switch       |                            |
|               |  - DNS Sinkhole & Remote Resolver        |                            |
|               +--------------------+---------------------+                            |
|                                    |                                                  |
|                   +----------------+----------------+                                 |
|                   |                                 |                                 |
|         HTTP Tunnel (Port 9080)           SOCKS5 Proxy (Port 9050)                    |
|                   |                                 |                                 |
|                   +----------------+----------------+                                 |
|                                    |                                                  |
|                  +-----------------+-----------------+                                |
|                  |     TOR CORE DAEMON (PORT 9051)   |                                |
|                  |     ControlPort Telnet Protocol   |                                |
|                  +-----------------+-----------------+                                |
+------------------------------------|--------------------------------------------------+
                                     | (Encrypted TLS Tunnel)
                                     v
+---------------------------------------------------------------------------------------+
|                             TOR ONION ROUTING NETWORK                                 |
|                                                                                       |
|   [ 01 · GUARD RELAY ]  ===>  [ 02 · MIDDLE RELAY ]  ===>  [ 03 · EXIT GATEWAY ]      |
|     Layer 3 Guard Key           Layer 2 Transit Key          Layer 1 Clear Payload    |
|       (IP Masked)                  (Zero-Knowledge)             (Public Egress)       |
+--------------------------------------------------------------------|------------------+
                                                                     v
                                                            [ TARGET INTERNET ]
                                                            (.onion Web / Clearnet)
```

---

## ⚡ Core Capabilities

### 1. Real-Time 3-Hop Circuit Topology Visualizer
- Inspect live Guard, Middle, and Exit node descriptors directly from the active Tor consensus.
- View verified relay IP addresses, bandwidth capacities, geographic jurisdiction flags, and node fingerprints.
- Click-to-verify integration querying the official [Tor Metrics Consensus API](https://metrics.torproject.org/).
- Real-time inbound and outbound throughput telemetry (`KB/s`).

### 2. Dual-Tier Zero-Leak Firewall Kill Switch
- **Tier 1 (Kernel Elevation):** Injects outbound block rules into the Windows Advanced Firewall (`netsh advfirewall firewall add rule name="GhostShield_Killswitch"`), blocking non-Tor internet egress on network disruption.
- **Tier 2 (Virtual Guard Fallback):** When running in unprivileged environments, routes system adapter proxies to a non-routable loopback blackhole (`127.0.0.1:9`) to prevent unencrypted failover.
- Real-time state persistence tracked in `state_killswitch.json`.

### 3. Dynamic Identity Rotation (`SIGNAL NEWNYM`)
- Instant cryptographic circuit destruction and new route negotiation within 1.2 to 2.5 seconds via ControlPort `9051`.
- Configurable autonomous rotation timer: Off, 30s, 1m, 5m, 10m.
- Per-country exit node targeting (Germany, Netherlands, Switzerland, United States, France, Sweden, Finland).

### 4. Anti-Detect Stealth Browser Sandbox
- Dedicated Chromium/Edge profiles isolated from host system cookies, cache, and identity markers.
- Injects dynamic canvas noise, WebGL vendor masking, audio context spoofing, and realistic client rects via `fingerprint-generator` and `fingerprint-injector`.
- Forces complete WebRTC IP leak suppression (`--disable-features=WebRtcHideLocalIpsWithMdns`).

### 5. Multi-Protocol Inbound Proxying
- **SOCKS5 Gateway:** `127.0.0.1:9050` (Full TCP support with remote DNS resolution).
- **HTTP / HTTPS Tunnel:** `127.0.0.1:9080` (Transparent forward proxy for standard CLI utilities and web software).
- **Windows System Proxy Auto-Configuration:** Automated Registry writes (`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`).

---

## 🚀 Quick Start

### Prerequisites
- **Operating System:** Windows 10/11 (x64) or Linux (Ubuntu 20.04+, Debian 11+, Arch)
- **Node.js:** v18.0.0 or higher
- **Python:** v3.8+ (for Windows Registry and Netsh orchestration)
- **Tor Core:** Bundled inside `bin/tor/` (Windows portable) or system `tor` on Linux.

### Installation

### 1-Click Automated Setup (Windows)
Simply double-click:
```cmd
setup.bat
```
This automated installer verifies Node.js, validates Python for Windows Firewall / Netsh orchestration, runs `npm install`, verifies Tor Core binaries, creates an optional 1-Click Desktop Shortcut, and launches the gateway.

### Manual / Cross-Platform Installation

```bash
# 1. Clone the repository
git clone https://github.com/rajannishad1015/GhostShield-VPN.git
cd GhostShield-VPN

# 2. Install production dependencies
npm install

# 3. Launch GhostShield Gateway
npm start
```

### 1-Click Gateway Launch (Windows)
Once setup is complete, double-click:
```cmd
start_portal.bat
```
The script will initialize the Tor daemon, spawn the Express gateway on `http://localhost:3000`, and automatically launch your default browser.

---

## 🔌 API Endpoints

GhostShield exposes a local RESTful control plane for headless orchestration and third-party integrations:

| Method | Endpoint | Description | Sample Output |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/status` | Complete gateway health, Tor bootstrap state, active IP, and traffic metrics | `{"tor":{"isBootstrapped":true},"virtualIp":{"ip":"185.x.x.x"}}` |
| `GET` | `/api/tor/circuit` | Live 3-hop cryptographic circuit nodes, IPs, and pool size | `{"available":true,"hops":[{"role":"Guard Node","ip":"46.x.x.x"}]}` |
| `POST` | `/api/rotate-ip` | Triggers immediate `SIGNAL NEWNYM` identity change | `{"success":true,"newIp":"45.x.x.x","country":"Netherlands"}` |
| `POST` | `/api/tor/new-circuit` | Destroys current circuit and forces a fresh 3-hop path | `{"success":true,"message":"Fresh circuit constructed"}` |
| `GET` | `/api/killswitch` | Returns active status of the Windows Firewall Kill Switch | `{"active":true,"mode":"netsh_firewall"}` |
| `POST` | `/api/killswitch` | Toggles firewall kill switch on or off (`{"enable": true}`) | `{"success":true,"active":true}` |
| `POST` | `/api/proxy/toggle` | Toggles Windows system-wide internet settings proxy | `{"success":true,"systemProxy":true}` |
| `POST` | `/api/stealth/launch` | Spawns sandboxed anti-fingerprinted stealth browser | `{"success":true,"status":"launched"}` |
| `GET` | `/api/logs` | Real-time Tor operational audit stream | `{"logs":[{"timestamp":"11:24:00","message":"Circuit established"}]}` |

---

## 🛡️ Threat Model & Zero-Leak Guarantees

| Attack Vector | Vulnerability in Standard VPNs | GhostShield Mitigation |
| :--- | :--- | :--- |
| **ISP Metadata Logging** | ISP logs destination IP and timing | Encrypted multi-hop onion routing; ISP only sees connection to verified Guard Relay. |
| **DNS Leakage** | UDP 53 fallback queries bypass VPN | All lookups resolved remotely inside Tor network via SOCKS5 remote handshake. |
| **WebRTC STUN Leaks** | Browser exposes real private/public IP via ICE | WebRTC STUN candidate discovery explicitly disabled at runtime engine level. |
| **Exit Node Snooping** | Malicious exit can monitor plaintext traffic | Zero-knowledge layered cryptography; exit node only sees final hop without origin context. |
| **Hardware Fingerprinting** | Canvas/WebGL/Font tracking correlates sessions | Injected synthetic noise masks GPU render signatures on every new identity cycle. |
| **Connection Drop Exposure** | Network glitch reverts to direct ISP route | Dual-tier Kill Switch severs adapter routes before unencrypted packets escape. |

---

## 📁 Repository Structure

```
GhostShield-VPN/
├── bin/
│   ├── tor/                    # Portable Tor Core binaries & GeoIP databases
│   └── start_portal.bat        # Windows 1-Click Bootstrap Launcher
├── public/
│   ├── index.html              # High-Performance Security Console UI
│   ├── style.css               # Tailscale/Cloudflare Tier Enterprise Stylesheet
│   ├── app.js                  # Frontend State & Telemetry Controller
│   ├── logo.png                # Official GhostShield Brand Emblem
│   └── favicon.png             # Browser Tab Icon
├── cloudflare_bypass.js        # Anti-Bot & Turnstile Bypass Engine
├── dns_sinkhole.js             # DNS Interception & Sinkholing Guard
├── killswitch.py               # Windows Advanced Firewall (netsh) Orchestrator
├── proxy_toggle.py             # Windows Registry System Proxy Controller
├── server.js                   # Primary Express Control Plane & API Server
├── stealth_launcher.js         # Anti-Detect Browser Sandbox Launcher
├── tor_controller.js           # Tor Process & ControlPort Telnet Client
├── package.json                # Project Manifest & Dependencies
├── .gitignore                  # Zero-Leak Git Exclusion Rules
└── README.md                   # Technical Documentation & Specifications
```

---

## 🔒 Security Disclosure

GhostShield is designed for security researchers, privacy advocates, journalists, and developers operating in hostile network environments. 

- This software does not log, store, or transmit telemetry to external third-party servers.
- All state files and credentials remain strictly local to your machine.
- To report a security vulnerability or bug, please open an Issue on GitHub.

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for details.

```
Copyright (c) 2026 Rajan Nishad
```
