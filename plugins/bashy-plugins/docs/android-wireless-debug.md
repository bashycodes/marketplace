# android-wireless-debug

Skill that lets Claude drive a real Android device over ADB to see, test and fix an app: connect, screenshot, tap through the UI by element name, read logcat/dumpsys, install APKs, and iterate until the fix is verified on the device.

Triggers when you hand over device details (an `IP:port`, a pairing code, "wireless debugging is on"), ask to test/install something on your phone, or report a bug that only shows on-device (layout, theme, insets, crashes).

## Connecting

`skills/android-wireless-debug/scripts/adb_connect.sh` runs a cascade, cheapest route first:

1. The persistent port (`adb tcpip 54321`, `ADB_TCP_PORT` to override) on the phone's **Tailscale** IP — the default; works from any network while Tailscale is up on both ends. Also tries `ADB_DEVICE_IP` and the default gateway (the phone, on its hotspot).
2. A USB cable → `adb tcpip 54321`.
3. adb already open elsewhere: an attached transport or an mDNS-advertised Wireless debugging port.
4. Android 11+ pairing with a 6-digit code — last, since it's the only route needing the user to read numbers off the screen.

Whenever steps 2–4 connect, the script opens the persistent port and reconnects on it, so the next session succeeds at step 1. The port lasts until the phone reboots.

## Taking the phone back

Once connected, **press the power button, or volume up-down-up-down** within 3 seconds, to cancel what Claude is doing on the phone. A background watcher (`skills/android-wireless-debug/scripts/stop_watch.sh`, started by the connect script) reads the phone's button events; it sees only those buttons, never the touchscreen. On a gesture it kills Claude's `adb -t <id> shell`/`exec-out` commands already running, along with the script that launched them. A PreToolUse hook then refuses Claude's next phone command once, telling it you cancelled, so it stops the task and waits for your next message. Nothing stays blocked: when you ask for more, Claude carries on. A cancel is only reported within 60 s of the press; phones with no power or volume buttons get no gesture. A SessionEnd hook stops the watcher when the session that connected ends.

If no watcher is running (no connection yet, or it lost the phone), the hook refuses Claude's phone commands and tells it to rerun `adb_connect.sh`, which restarts the watcher; Claude does that on its own. This applies only once Claude has run `adb_connect.sh` on this machine (marker: `${XDG_STATE_HOME:-~/.local/state}/android-wireless-debug/enabled`); before that the hook refuses nothing, so `bashy-plugins` users who never use this skill are unaffected. After that, the hook applies to every Claude Code session while `bashy-plugins` is enabled, so adb used for other work also needs `adb_connect.sh` first; delete the marker to opt out again.

## Requirements

- `adb` (Android platform-tools) on `PATH`
- Tailscale on both machine and phone (optional, for reaching the phone off-LAN)
- Developer options + Wireless debugging (or USB debugging) enabled on the device

## Contents

| Path | Purpose |
|---|---|
| `skills/android-wireless-debug/SKILL.md` | The workflow: connect → look → root-cause → fix → reinstall → look again |
| `skills/android-wireless-debug/scripts/adb_connect.sh` | Connection cascade |
| `skills/android-wireless-debug/scripts/stop_watch.sh` | Watches the phone's buttons for the stop gesture |
| `skills/android-wireless-debug/scripts/stop_hook.sh` + `hooks/hooks.json` | PreToolUse hook: refuses the next phone command after a cancel, and phone commands while no watcher runs; SessionEnd cleanup |
| `skills/android-wireless-debug/scripts/ui_find.sh` | Resolve a UI element to tap coordinates via uiautomator dump |
| `skills/android-wireless-debug/references/ui-driving.md` | Driving the UI without eyeballing pixels |
| `skills/android-wireless-debug/references/diagnostics.md` | Theme, insets, packaging and crash diagnostics from system state |
| `skills/android-wireless-debug/references/wsl-and-usb.md` | WSL, USB-to-TCP, hotspot setups and closing the port afterwards |
