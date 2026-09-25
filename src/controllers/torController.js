const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

class TorController {
  constructor(options = {}) {
    this.torExe = options.torExe || path.resolve(__dirname, '../tor-ip-changer/tor/tor.exe');
    this.dataDir = options.dataDir || path.resolve(__dirname, 'tor_data');
    this.geoipFile = options.geoipFile || path.resolve(__dirname, '../tor-ip-changer/tor/geoip');
    this.geoip6File = options.geoip6File || path.resolve(__dirname, '../tor-ip-changer/tor/geoip6');
    this.socksPort = options.socksPort || 9050;
    this.controlPort = options.controlPort || 9051;
    this.process = null;
    this.isBootstrapped = false;
    this.bootstrapProgress = 0;
    this.bootstrapStatus = 'Starting...';
    this.logs = [];
    this.lastIpChange = null;
    this.exitCountry = options.exitCountry || 'random';

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  log(msg, type = 'info') {
    const entry = {
      timestamp: new Date().toLocaleTimeString(),
      message: msg,
      type
    };
    this.logs.unshift(entry);
    if (this.logs.length > 100) this.logs.pop();
    console.log(`[TorController] ${msg}`);
  }

  async start() {
    // Check if Tor is already running on the port
    const isControlOpen = await this.checkPort(this.controlPort);
    if (isControlOpen) {
      this.log('Existing Tor instance detected on control port. Connecting...', 'warn');
      this.isBootstrapped = true;
      this.bootstrapProgress = 100;
      this.bootstrapStatus = 'Ready';
      return;
    }

    try {
      // Kill any orphaned tor.exe first
      try {
        execSync('taskkill /F /IM tor.exe', { stdio: 'ignore' });
      } catch (e) {
        // ignore if not running
      }

      this.log(`Spawning Tor engine from: ${this.torExe}`, 'info');

      const args = [
        '--SocksPort', `127.0.0.1:${this.socksPort}`,
        '--HTTPTunnelPort', '127.0.0.1:9080',
        '--DNSPort', '127.0.0.1:9053',
        '--ControlPort', `127.0.0.1:${this.controlPort}`,
        '--CookieAuthentication', '0',
        '--HashedControlPassword', '',
        '--DataDirectory', this.dataDir,
        '--GeoIPFile', this.geoipFile,
        '--GeoIPv6File', this.geoip6File,
        '--SafeLogging', '0',
        '--AvoidDiskWrites', '1'
      ];

      if (this.exitCountry && this.exitCountry !== 'random') {
        args.push('--ExitNodes', `{${this.exitCountry}}`, '--StrictNodes', '1');
      }

      this.process = spawn(this.torExe, args);

      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Parse bootstrap percentage
          const match = trimmed.match(/Bootstrapped (\d+)% \((.*?)\): (.*)/);
          if (match) {
            this.bootstrapProgress = parseInt(match[1], 10);
            this.bootstrapStatus = match[3];
            this.log(`Tor Progress: ${this.bootstrapProgress}% - ${this.bootstrapStatus}`, 'tor');
            if (this.bootstrapProgress === 100) {
              this.isBootstrapped = true;
            }
          } else if (trimmed.includes('WarningsAboutSOCKSandDNSInformationLeaks') || trimmed.includes('giving Tor only an IP address')) {
            // Informational advisory warning from Tor about SOCKS4 IP connection; ignore to keep logs clean
            continue;
          } else if (trimmed.includes('[warn]') || trimmed.includes('[err]')) {
            this.log(trimmed, 'error');
          } else {
            this.log(trimmed, 'tor');
          }
        }
      });

      this.process.stderr.on('data', (data) => {
        this.log(data.toString().trim(), 'error');
      });

      this.process.on('close', (code) => {
        this.log(`Tor process exited with code ${code}`, 'warn');
        this.isBootstrapped = false;
      });

      // Wait until Tor is ready or timeout (up to 30s)
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (this.isBootstrapped) {
          this.log('Tor successfully bootstrapped and ready to route traffic!', 'success');
          return;
        }
      }
    } catch (err) {
      this.log(`Failed to start Tor: ${err.message}`, 'error');
      throw err;
    }
  }

  async checkPort(port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(800);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, '127.0.0.1');
    });
  }

  async sendControlCommand(command) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let state = 'AUTH_SENT';
      let buffer = '';

      socket.setTimeout(6000);

      socket.connect(this.controlPort, '127.0.0.1', () => {
        socket.write('AUTHENTICATE\r\n');
      });

      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        if (state === 'AUTH_SENT' && buffer.includes('250 OK')) {
          state = 'CMD_SENT';
          buffer = '';
          socket.write(`${command}\r\n`);
        } else if (state === 'CMD_SENT' && (buffer.includes('250 OK') || buffer.includes('250 '))) {
          state = 'DONE';
          const result = buffer.trim();
          socket.end();
          resolve(result);
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Control port timeout'));
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });

      socket.on('close', () => {
        if (state !== 'DONE') {
          resolve(buffer.trim() || 'OK');
        }
      });
    });
  }

  async rotateIp() {
    this.log('Requesting new Tor Virtual IP (SIGNAL NEWNYM)...', 'info');
    try {
      const res = await this.sendControlCommand('SIGNAL NEWNYM');
      this.lastIpChange = new Date();
      this.log(`Identity refreshed successfully: ${res}`, 'success');
      return { success: true, message: 'New identity requested', timestamp: this.lastIpChange };
    } catch (err) {
      this.log(`Failed to rotate IP: ${err.message}`, 'error');
      return { success: false, error: err.message };
    }
  }

  async getTrafficStats() {
    try {
      const raw = await this.sendControlCommand('GETINFO traffic/read traffic/written');
      const readMatch = raw.match(/traffic\/read=(\d+)/);
      const writtenMatch = raw.match(/traffic\/written=(\d+)/);

      const now = Date.now();
      const readBytes = readMatch ? parseInt(readMatch[1], 10) : 0;
      const writtenBytes = writtenMatch ? parseInt(writtenMatch[1], 10) : 0;

      let downSpeed = '0 KB/s';
      let upSpeed = '0 KB/s';

      if (this._lastTrafficTime) {
        const timeDiffSec = Math.max(0.1, (now - this._lastTrafficTime) / 1000);
        const readDiff = Math.max(0, readBytes - (this._lastReadBytes || readBytes));
        const writtenDiff = Math.max(0, writtenBytes - (this._lastWrittenBytes || writtenBytes));

        const downKbps = (readDiff / 1024) / timeDiffSec;
        const upKbps = (writtenDiff / 1024) / timeDiffSec;

        downSpeed = downKbps >= 1024 ? `${(downKbps / 1024).toFixed(1)} MB/s` : `${downKbps.toFixed(1)} KB/s`;
        upSpeed = upKbps >= 1024 ? `${(upKbps / 1024).toFixed(1)} MB/s` : `${upKbps.toFixed(1)} KB/s`;
      }

      this._lastTrafficTime = now;
      this._lastReadBytes = readBytes;
      this._lastWrittenBytes = writtenBytes;

      const formatBytes = (bytes) => {
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${Math.round(bytes / 1024)} KB`;
      };

      return {
        readBytes,
        writtenBytes,
        totalDown: formatBytes(readBytes),
        totalUp: formatBytes(writtenBytes),
        downSpeed,
        upSpeed
      };
    } catch (err) {
      return {
        readBytes: 0,
        writtenBytes: 0,
        totalDown: '0 MB',
        totalUp: '0 MB',
        downSpeed: '0 KB/s',
        upSpeed: '0 KB/s',
        error: err.message
      };
    }
  }

  async getCircuitDetails() {
    const countryNames = {
      'us': 'United States', 'de': 'Germany', 'nl': 'Netherlands', 'fr': 'France',
      'gb': 'United Kingdom', 'ca': 'Canada', 'ch': 'Switzerland', 'se': 'Sweden',
      'pl': 'Poland', 'ro': 'Romania', 'fi': 'Finland', 'no': 'Norway', 'es': 'Spain',
      'it': 'Italy', 'at': 'Austria', 'is': 'Iceland', 'in': 'India', 'jp': 'Japan',
      'sg': 'Singapore', 'au': 'Australia', 'cz': 'Czechia', 'bg': 'Bulgaria',
      'dk': 'Denmark', 'be': 'Belgium', 'ie': 'Ireland', 'nz': 'New Zealand',
      'ru': 'Russia', 'ua': 'Ukraine', 'br': 'Brazil', 'md': 'Moldova', 'lu': 'Luxembourg'
    };

    try {
      const statusRaw = await this.sendControlCommand('GETINFO circuit-status');
      const lines = statusRaw.split('\n');
      const builtCircuits = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.includes(' BUILT ')) continue;
        const parts = trimmed.split(' ');
        const id = parts[0];
        const pathPart = parts[2] || '';
        const hops = pathPart.split(',').filter(Boolean);
        if (hops.length >= 3) {
          builtCircuits.push({
            id,
            raw: trimmed,
            hops: hops.map((h, idx) => {
              const [fp, nick] = h.replace('$', '').split('~');
              return {
                hopIndex: idx + 1,
                role: idx === 0 ? 'Guard Node' : idx === hops.length - 1 ? 'Exit Relay' : 'Middle Relay',
                fingerprint: fp,
                nickname: nick || 'Unnamed Relay'
              };
            })
          });
        }
      }

      if (builtCircuits.length === 0) {
        return { available: false, circuits: [] };
      }

      // Pick general circuit or first built circuit
      const target = builtCircuits.find(c => c.raw.includes('PURPOSE=GENERAL')) || builtCircuits[0];

      // Fetch descriptors for all hops
      const nsCmd = 'GETINFO ' + target.hops.map(h => 'ns/id/' + h.fingerprint).join(' ');
      const nsRaw = await this.sendControlCommand(nsCmd);

      const ips = [];
      for (const hop of target.hops) {
        const regex = new RegExp('r ' + hop.nickname + ' \\S+ \\S+ \\S+ \\S+ (\\d+\\.\\d+\\.\\d+\\.\\d+)');
        const match = nsRaw.match(regex);
        if (match) {
          hop.ip = match[1];
          ips.push(match[1]);
        } else {
          hop.ip = 'Hidden / Encrypted';
        }

        const bwRegex = new RegExp('ns/id/' + hop.fingerprint + '=[\\s\\S]*?w Bandwidth=(\\d+)');
        const bwMatch = nsRaw.match(bwRegex);
        if (bwMatch) {
          const bwMb = Math.round(parseInt(bwMatch[1], 10) / 1000);
          hop.bandwidth = `${bwMb} MB/s`;
        } else {
          hop.bandwidth = 'High';
        }
      }

      // Fetch countries
      if (ips.length > 0) {
        const validIps = ips.filter(ip => ip.includes('.'));
        if (validIps.length > 0) {
          const geoCmd = 'GETINFO ' + validIps.map(ip => 'ip-to-country/' + ip).join(' ');
          const geoRaw = await this.sendControlCommand(geoCmd);
          for (const hop of target.hops) {
            if (hop.ip && hop.ip.includes('.')) {
              const geoMatch = geoRaw.match(new RegExp('ip-to-country/' + hop.ip.replace(/\\./g, '\\\\.') + '=([a-zA-Z]{2})'));
              if (geoMatch) {
                const code = geoMatch[1].toLowerCase();
                hop.countryCode = code.toUpperCase();
                hop.country = countryNames[code] || code.toUpperCase();
              } else {
                hop.countryCode = 'INT';
                hop.country = 'Global Network';
              }
            } else {
              hop.countryCode = 'INT';
              hop.country = 'Relay Network';
            }
          }
        }
      }

      return {
        available: true,
        circuitId: target.id,
        totalBuiltCircuits: builtCircuits.length,
        hops: target.hops
      };
    } catch (err) {
      return {
        available: false,
        error: err.message,
        hops: []
      };
    }
  }

  async requestNewCircuit() {
    this.log('Building fresh Tor Circuit...', 'info');
    try {
      const circ = await this.getCircuitDetails();
      if (circ && circ.circuitId) {
        try {
          await this.sendControlCommand(`CLOSECIRCUIT ${circ.circuitId}`);
        } catch (e) {}
      }
      await this.sendControlCommand('SIGNAL NEWNYM');
      this.lastIpChange = new Date();
      // Short delay for Tor to establish new circuit
      await new Promise(r => setTimeout(r, 800));
      const newCirc = await this.getCircuitDetails();
      return { success: true, circuit: newCirc };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  stop() {
    if (this.process) {
      this.log('Stopping Tor process...', 'info');
      try {
        this.process.kill();
      } catch (e) {}
      this.process = null;
    }
  }
}

module.exports = TorController;
