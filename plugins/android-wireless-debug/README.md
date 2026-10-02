# android-wireless-debug

Skill that lets Claude drive a real Android device over ADB to see, test and fix an app: connect, screenshot, tap through the UI by element name, read logcat/dumpsys, install APKs, and iterate until the fix is verified on the device.

Triggers when you hand over device details (an `IP:port`, a pairing code, "wireless debugging is on"), ask to test/install something on your phone, or report a bug that only shows on-device (layout, theme, insets, crashes).

## Connecting

`scripts/adb_connect.sh` runs a cascade, cheapest route first:

1. The persistent port (`adb tcpip 54321`, `ADB_TCP_PORT` to override) on the phone's **Tailscale** IP — the default; works from any network while Tailscale is up on both ends. Also tries `ADB_DEVICE_IP` and the default gateway (the phone, on its hotspot).
2. A USB cable → `adb tcpip 54321`.
3. adb already open elsewhere: an attached transport or an mDNS-advertised Wireless debugging port.
4. Android 11+ pairing with a 6-digit code — last, since it's the only route needing the user to read numbers off the screen.

Whenever steps 2–4 connect, the script opens the persistent port and reconnects on it, so the next session succeeds at step 1. The port lasts until the phone reboots.

## Requirements

- `adb` (Android platform-tools) on `PATH`
- Tailscale on both machine and phone (optional, for reaching the phone off-LAN)
- Developer options + Wireless debugging (or USB debugging) enabled on the device

## Contents

| Path | Purpose |
|---|---|
| `skills/android-wireless-debug/SKILL.md` | The workflow: connect → look → root-cause → fix → reinstall → look again |
| `scripts/adb_connect.sh` | Connection cascade |
| `scripts/ui_find.sh` | Resolve a UI element to tap coordinates via uiautomator dump |
| `references/ui-driving.md` | Driving the UI without eyeballing pixels |
| `references/diagnostics.md` | Theme, insets, packaging and crash diagnostics from system state |
| `references/wsl-and-usb.md` | WSL, USB-to-TCP, hotspot setups and closing the port afterwards |
