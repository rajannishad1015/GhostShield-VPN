import sys
import winreg
import ctypes

INTERNET_OPTION_SETTINGS_CHANGED = 39
INTERNET_OPTION_REFRESH = 37
HWND_BROADCAST = 0xFFFF
WM_SETTINGCHANGE = 0x001A
SMTO_ABORTIFHUNG = 0x0002

def notify_wininet():
    try:
        wininet = ctypes.windll.Wininet
        wininet.InternetSetOptionW(0, INTERNET_OPTION_SETTINGS_CHANGED, 0, 0)
        wininet.InternetSetOptionW(0, INTERNET_OPTION_REFRESH, 0, 0)
        # Broadcast to all top-level windows so browsers (Chrome, Edge) update immediately
        user32 = ctypes.windll.user32
        result = ctypes.c_ulong()
        user32.SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, "Internet Settings", SMTO_ABORTIFHUNG, 1000, ctypes.byref(result))
    except Exception as e:
        print(f"Wininet notify error: {e}", file=sys.stderr)

def get_status():
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Internet Settings', 0, winreg.KEY_READ)
        val, _ = winreg.QueryValueEx(key, 'ProxyEnable')
        winreg.CloseKey(key)
        return bool(val)
    except Exception:
        return False

def set_proxy(enable=True, http_port=9080):
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Internet Settings', 0, winreg.KEY_WRITE)
        winreg.SetValueEx(key, 'ProxyEnable', 0, winreg.REG_DWORD, 1 if enable else 0)
        if enable:
            # Route HTTP and HTTPS through Tor HTTPTunnelPort 9080
            winreg.SetValueEx(key, 'ProxyServer', 0, winreg.REG_SZ, f'http=127.0.0.1:{http_port};https=127.0.0.1:{http_port}')
            # CRITICAL: Always bypass localhost/127.0.0.1 so the web dashboard (http://localhost:3000) works seamlessly
            # and DO NOT bypass *.cloudflare.com so that IP checking and cloudflare sites go through Tor!
            winreg.SetValueEx(key, 'ProxyOverride', 0, winreg.REG_SZ, 'localhost;127.0.0.1;127.*;10.*;192.168.*;<local>')
            # Disable Windows Certificate Revocation checking to prevent CRYPT_E_REVOCATION_OFFLINE errors through Tor
            winreg.SetValueEx(key, 'CertificateRevocation', 0, winreg.REG_DWORD, 0)
        else:
            winreg.SetValueEx(key, 'CertificateRevocation', 0, winreg.REG_DWORD, 1)
        winreg.CloseKey(key)
        notify_wininet()
        print(f'{{"success": true, "enabled": {str(enable).lower()}}}')
    except Exception as e:
        print(f'{{"success": false, "error": "{str(e)}"}}')

if __name__ == '__main__':
    arg = sys.argv[1].lower() if len(sys.argv) > 1 else 'status'
    if arg == 'on':
        set_proxy(True)
    elif arg == 'off':
        set_proxy(False)
    else:
        status = get_status()
        print(f'{{"enabled": {str(status).lower()}}}')
