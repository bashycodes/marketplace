# android-wireless-debug

Skill that lets Claude drive a real Android device over ADB to see, test and fix an app: connect, screenshot, tap through the UI by element name, read logcat/dumpsys, install APKs, and iterate until the fix is verified on the device.

Triggers when you hand over device details (an `IP:port`, a pairing code, "wireless debugging is on"), ask to test/install something on your phone, or report a bug that only shows on-device (layout, theme, insets, crashes).

## Connecting

`scripts/adb_connect.sh` runs a cascade, cheapest route first:

1. A TCP port the phone already listens on (default `54321`, `ADB_TCP_PORT` to override) at the default gateway — which *is* the phone when you're on its hotspot. Works with the phone's Wi-Fi off.
2. Bootstrap that port over USB (`adb tcpip`) once; the cable can then come out until the phone reboots. Covers a greyed-out Wireless debugging toggle and WSL setups where only USB reaches the device.
3. Android 11+ pairing with a 6-digit code — last, since it's the only route needing the user to read numbers off the screen.

## Requirements

- `adb` (Android platform-tools) on `PATH`
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
