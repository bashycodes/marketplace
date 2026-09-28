# Getting a wireless port when the pairing flow is unavailable

Android 11+ "Wireless debugging" is a TLS-wrapped, pairing-code-gated wrapper
around a capability that has existed since forever: `adbd` listening on a TCP
port. The wrapper needs the phone to be a Wi-Fi **client**. When it cannot be
one, the underlying capability is still reachable — you just have to open it
yourself, over the cable, once.

## Why the toggle greys out

Android gates Wireless debugging on an associated Wi-Fi network. A phone that
is running a hotspot with Wi-Fi off has `swlan0` (the softAP interface) up with
an address, and `wlan0` present but unassociated. There is no Wi-Fi *connection*
to bind to, so the toggle is dead. Nothing you can do from `adb` fixes this;
it is a UI precondition, not a bug.

Check it from the device:

```bash
$D shell ip -4 -o addr show scope global
# swlan0 10.119.65.15/24  -> softAP (Samsung/Qualcomm; ap0 / wlan1 / softap0 elsewhere)
# wlan0  <absent>         -> not a client, toggle will be greyed out
```

## The hotspot topology

When your machine is on the phone's hotspot, the phone is simultaneously the
access point, the DHCP server, your default gateway, and the adb target. So:

```bash
ip route | awk '/^default/{print $3}'    # this IS the phone
```

A quick sanity check that the gateway really is an Android hotspot: look at the
second hex digit of its MAC (`ip neigh`). If it is 2, 6, A or E, the
locally-administered bit is set — a software-generated address with no IEEE
vendor prefix, which is what Android softAP BSSIDs look like.

## Opening the port over USB

`adb tcpip <port>` is itself an adb command, so it has to travel over an
already-authenticated transport. With the pairing flow unavailable, USB is the
only way in. The cable is needed **once, for about thirty seconds**.

```bash
adb -s <serial> tcpip 54321      # "restarting in TCP mode port: 54321"
# unplug
adb connect <phone-ip>:54321
```

Changing the port later works fine over the wireless link — no cable, no
re-authorisation:

```bash
adb -s <serial> tcpip 5555
adb disconnect <phone-ip>:54321
adb connect <phone-ip>:5555
```

## WSL2 specifics

**WSL has no USB stack.** A Linux `adb` inside WSL can never see a USB device.
Only a Windows-side `adb.exe` can. What makes this workable without usbipd-win
is `networkingMode=Mirrored`:

```bash
cat /mnt/c/Users/*/.wslconfig
# [wsl2]
# networkingMode=Mirrored
```

Mirrored mode shares Windows' interfaces **and localhost**, so both sides see
the same `127.0.0.1:5037`. adb splits into client (the `adb` you type), server
(a daemon on 5037 that owns the USB connections and the RSA key), and `adbd` on
the phone. Start the server from Windows and the Linux client drives it — WSL
gets USB access for free, and reaches the phone's LAN address with no port
forwarding.

Order matters. Whichever side starts the server first owns 5037, and a
Linux-started server has no USB:

```bash
adb kill-server
/mnt/c/Users/<you>/platform-tools/adb.exe devices -l   # Windows server, sees USB
adb devices -l                                          # Linux client, same server
```

Two traps:

- **`C:\Windows\adb.exe`** is a common stray, usually adb 1.0.32 with 2015-era
  `AdbWinApi.dll`. Its daemon just fails: `ADB server didn't ACK / * failed to
  start daemon *`. It shadows a good adb if the Windows PATH is used. Delete it
  or ignore it — never call it.
- **What decides whether two adbs fight is the `1.0.XX` protocol number, not
  the platform-tools release.** 1.0.41 (platform-tools 34) and 1.0.41
  (platform-tools 37) coexist happily on the same server. 1.0.32 vs 1.0.41 ends
  in "adb server is out of date. killing...".

Get current platform-tools:

```bash
cd /mnt/c/Users/$USER && curl -L -o platform-tools.zip \
  https://dl.google.com/android/repository/platform-tools-latest-windows.zip
unzip -oq platform-tools.zip
```

## Authorising the computer

`ro.adb.secure=1` on any production build means `adbd` challenges every
connecting client to sign a random token with the key in `~/.android/adbkey`.
An unknown key gets `unauthorized` and raises "Allow USB debugging?" on the
phone, which needs a physical unlock and a tap. This applies to TCP transports
too — the open port is not an open door.

If no dialog appears: replug, or Developer options ▸ **Revoke USB debugging
authorisations**, then replug.

**The key is the credential, not the port.** `~/.android/adbkey` (and
`C:\Users\<you>\.android\adbkey` — note that WSL and Windows have *separate*
keys, and the one the phone trusts is whichever server did the authorising) is
an unencrypted RSA private key. Anyone who copies it can authenticate to the
phone from any network the phone is on.

## How long the port stays open

| Closes it | Doesn't close it |
|---|---|
| Rebooting the phone | `adb disconnect` (drops *your* end only) |
| `adb -s <serial> usb` | shutting down the laptop |
| `adb -s <serial> tcpip <other port>` | toggling the hotspot or airplane mode |
| Turning USB debugging off | Doze, screen off, elapsed time |

`service.adb.tcp.port` is non-persistent — only `persist.*` properties survive
a boot, and no `persist.adb.tcp.port` exists on stock builds. So "until reboot"
is the real answer, which on a phone with a week of uptime means "indefinitely".

**`adb disconnect` is not a teardown.** Reopening after a disconnect is one
`adb connect`. Reopening after `adb usb` needs the cable again, because there
is no longer any authenticated transport to carry `adb tcpip`. Say which one
you mean.

## Security shape of the legacy port

Worth stating plainly when you leave one open on someone's personal phone:

- It is **plaintext**. The pairing flow wraps adb in TLS; `adb tcpip` does not.
- `adbd` binds `INADDR_ANY` — `[::]:54321`, every interface. There is no
  bind-address property; the only knob is the port number. So the port follows
  the phone onto every network it later joins.
- RSA auth still stands in the way, so this is not the ADB.Miner scenario
  (that hit devices shipped with `ro.adb.secure=0`). An attacker on the network
  gets `unauthorized` unless someone taps the dialog for them.
- If they *do* get in, they get `shell`, not root, on a locked bootloader:
  install/uninstall, `/sdcard`, logcat, screenshots, and input injection — full
  UI control, but not past the lock screen.

Practical mitigations, best first: restrict the network (a hotspot MAC
allowlist — Samsung: Settings ▸ Connections ▸ Mobile Hotspot ▸ ⋮ ▸ Allowed
devices), treat an unexpected authorisation dialog as an intrusion alarm rather
than something to tap through, and run `adb -s <serial> usb` before the phone
joins a network the user does not own. A non-default port defeats mass scanners
and nothing else.

Verify what is actually listening:

```bash
$D shell cat /proc/net/tcp6 | awk '$4=="0A"'   # 0A = LISTEN; port is hex in col 2
timeout 2 bash -c "echo > /dev/tcp/<phone-ip>/54321"   # from the laptop
```
