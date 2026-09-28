---
name: android-wireless-debug
description: >-
  Drive a real Android phone over ADB wireless debugging to see, test and fix an app — connect, screenshot, tap through the UI, read logcat/dumpsys, install APKs, and iterate on a fix until it is verified on the device. Use this whenever the user offers device connection details (an IP:port, a "pair with device" code, "wireless debugging is on"), or asks you to try/test/debug/install something on their phone, tablet, Pixel, Galaxy or "my device" — and equally when they report an app bug you cannot reproduce by reading code, such as "it looks wrong on my phone", "the button is cut off", "it's in light mode but my app is dark", "it crashes on my device". Prefer this over reasoning from source alone: layout, theme, inset and packaging bugs are frequently invisible in code and obvious in one screenshot. Covers connecting even when Wireless debugging is unavailable — a phone running a hotspot with Wi-Fi off, a greyed-out toggle, or a Windows/WSL machine where only the USB cable can reach the device — by opening an adb TCP port over the cable once.
---

# Debugging on a real Android device over wireless ADB

Some bugs cannot be found by reading code. Anything involving the window, the
theme, system insets, the device's OEM skin, or how the OS actually installed
your package will look perfectly correct in source and wrong on screen. A single
screenshot settles in seconds what an hour of reasoning cannot. When a user
hands you device access, take it and *look*.

The loop is: **connect → look → root-cause from the system's own state → fix →
reinstall → look again.**

## Connecting

Run the cascade. It tries the cheapest route first and prints what it did:

```bash
scripts/adb_connect.sh
```

1. **A TCP port the phone is already listening on** — default `54321`, override
   with `ADB_TCP_PORT`. The address defaults to this machine's default gateway,
   which *is* the phone when you are on its hotspot. One TCP probe, no user
   involvement, works on a phone with Wi-Fi off entirely.
2. **Bootstrap that port over USB** — `adb tcpip 54321` sent down the cable,
   after which the cable comes out and stays out until the phone reboots. Needs
   the phone unlocked once to authorise the computer.
3. **Android 11+ pairing with a 6-digit code** — last, because it is the only
   route that needs the user to go and read numbers off a screen. The script
   prints exactly what to ask for.

Route 2 is what makes this work on a phone that *cannot* use the pairing flow
at all. Details, WSL specifics and the security tradeoff of leaving a port
open: **`references/wsl-and-usb.md`**.

### When the user names a route

Read the intent off the invocation rather than running the cascade:

| They say | Run |
|---|---|
| `/android-wireless-debug` | `scripts/adb_connect.sh` — the cascade, no questions |
| `... over USB`, `... with the cable` | `scripts/adb_connect.sh --usb` |
| `... 10.0.0.5:43657 888999` | `scripts/adb_connect.sh 10.0.0.5:43657 888999` — pairs, then finds the connect port itself |
| `... 10.0.0.5:43657` | `scripts/adb_connect.sh 10.0.0.5:43657` |
| `... on port 5555` | `ADB_TCP_PORT=5555 scripts/adb_connect.sh` |

**An address with a 6-digit code is always the *pairing* address** — the
pairing dialog is the only screen that shows both together. An address on its
own is a connect address. Don't ask which; the code settles it.

Pairing and connecting use **two different ports**, so a pairing address alone
is not enough to finish. The script recovers the missing connect port from
mDNS: a phone with Wireless debugging open advertises `_adb-tls-connect._tcp`,
and adb has usually auto-connected to it by the time pairing returns — check
`adb mdns services` to see what it found. Only if mDNS comes up empty (it often
does across subnets, VPNs and some WSL setups) do you need to ask for the
connect address from the main screen, and pass all three:

```bash
scripts/adb_connect.sh <IP:PORT> <IP:PAIR_PORT> <code>   # freshly opened dialog
```

The code is single-use and dies with the dialog, so a second attempt always
needs a new one.

### What route 3 needs from the user

From **Settings ▸ Developer options ▸ Wireless debugging**, phone and machine
on the same network:

| You need | Where they find it | Notes |
|---|---|---|
| **Pairing address** `IP:PAIR_PORT` and **code** | "Pair device with pairing code" dialog | One-time; the code expires when the dialog closes |
| **Connect address** `IP:PORT` | the main Wireless debugging screen | **A different port** — this trips people up. Changes on reboot or Wi-Fi toggle |

Pairing persists, so later sessions usually need only the connect address. If
`adb connect` fails on a device you have paired before, ask for a fresh code.

**The toggle is greyed out when the phone is not a Wi-Fi client** — hotspot on
with Wi-Fi off is the usual cause, and it is a precondition of the OS, not
something to troubleshoot. Take route 2 instead of trying to talk them into it.

### Use `adb -t <transport_id>` for everything afterwards

The script prints it. A wirelessly connected phone often appears *twice* in
`adb devices` — once as the IP endpoint and once as an mDNS entry
(`adb-R5CY..._adb-tls-connect._tcp`) — so a bare `adb shell` dies with "more
than one device".

```bash
D="adb -t 5"
$D shell getprop ro.build.version.release
```

If a later command fails with `no device with transport id 'N'`, the transport
dropped — the phone's port is almost certainly still open. Rerun the script
(route 1 picks it back up in seconds) and use the new id.

## Looking at the screen

```bash
adb -t 5 exec-out screencap -p > shot.png
```

Use `exec-out`, not `shell`: `shell` mangles the binary PNG through the
pseudo-terminal. Then view it with the Read tool.

**The coordinate trap.** Screenshots are downscaled for display, and the tool
tells you the ratio ("original 1080x2340, displayed at 923x2000, multiply by
1.17"). Tap coordinates must be in *device* pixels, so multiply whatever you
measure off the image. Forgetting this makes taps land slightly high and left,
which reads as "the tap did nothing" and sends you off debugging the wrong thing.

Full UI-driving reference — taps, swipes, text entry, keyevents, and locating
elements without eyeballing pixels: **`references/ui-driving.md`**.

## Finding the real cause

Do not stop at "it looks wrong". Ask the system what it believes is true; the
answer usually names the bug outright. The highest-yield probes:

```bash
D="adb -t 5"
$D shell dumpsys window windows | grep -A 20 "MyActivity"   # frame, flags, configuration
$D shell cmd uimode night                                    # is the device in dark mode?
$D logcat -c && <do the thing> && $D logcat -d | grep -i mytag
```

Two findings that cracked real bugs and are easy to walk past:

- **`mFullConfiguration`** in the window dump carries `night`, locale, density
  and size. If your code concluded the app is in light mode and this says
  `night`, your theme detection is wrong — that is the whole answer, obtained
  without touching the app.
- **Toast lines in logcat name their caller**: `Toast: show: caller =
  com.example.Foo.onClick:119`. Free proof of which code path ran, with a line
  number, without adding any logging of your own.

More recipes — inset and edge-to-edge forensics, theme and configuration
inspection, crash/ANR triage, package and permission state:
**`references/diagnostics.md`**.

## Installing and iterating

```bash
adb -t 5 install -r app.apk
```

`-r` reinstalls in place and **keeps app data**, which is what makes the
edit → build → install → look loop fast: test config, logins and sample data all
survive, so you land straight back on the screen you were debugging.

Common install failures and what they actually mean:

| Failure | Cause | Fix |
|---|---|---|
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | signed with a different key than the installed copy | uninstall first — **warn the user this erases local app data** and let them decide |
| `INSTALL_FAILED_NO_MATCHING_ABIS` | the APK lacks the device's ABI | compare `aapt2 dump badging app.apk \| grep native-code` with `adb shell getprop ro.product.cpu.abilist` |
| `INSTALL_PARSE_FAILED_NO_CERTIFICATES` | unsigned build | sign it |
| Install refused with no useful error, on a Samsung | **Auto Blocker** (One UI 6.1+, on by default) silently blocks *all* sideloading, `adb install` included | Settings ▸ Security and privacy ▸ Auto Blocker ▸ off |

Once a fix is built, reinstall and **re-verify the way you found the bug** — same
screen, same screenshot, same dump. A fix you have not watched work on the device
is a hypothesis, not a fix.

Script the navigation. As soon as you know the path to the broken screen, put the
whole thing in one command with sleeps between steps:

```bash
D="adb -t 5"
$D install -r app.apk
$D shell monkey -p com.example -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 5
$D shell input tap 76 172;  sleep 2
$D shell input tap 825 221; sleep 3
$D exec-out screencap -p > after.png
```

Each iteration becomes a single command instead of a dozen round trips, and every
screenshot starts from an identical state — so the differences you see are real
changes rather than drift in where you happened to tap.

## Working on someone's personal phone

This is not a lab device. It holds their real messages, photos and accounts.

- **Restore anything you change.** Toggling system state to test (dark mode via
  `cmd uimode night no`, rotation, font scale) is fair game and often necessary —
  put it back immediately afterwards and tell the user you did.
- **Say what you are about to do** before anything destructive: uninstalling,
  clearing app data, changing settings that persist.
- **Screenshots capture whatever is on screen**, including notifications and
  personal content. Take what the task needs; don't wander through unrelated apps.
- **Disconnect when you're done** (`adb disconnect <ip:port>`). Pairing survives,
  so reconnecting later is cheap — there's no reason to sit on a live connection
  to someone's phone.
- **`adb disconnect` does not close the port.** It drops your end only; a port
  you opened over USB keeps listening on every interface until the phone
  reboots. Closing it for real is `adb -s <serial> usb`, which costs a cable the
  next time. Be clear which one you mean, and read the security section of
  `references/wsl-and-usb.md` before leaving one open on a personal phone.
- Prefer read-only probes (`dumpsys`, `logcat`, screenshots) over anything that
  writes. Don't `adb root`, remount, or touch another app's data unless that is
  explicitly the task.

## Things that will waste your time if you don't know them

- **`am start` on a non-exported activity is refused** —
  `SecurityException: ... not exported from uid NNNN`. That is correct behaviour,
  not a broken build. Navigate through the app's own UI instead. Exported
  activities do start fine, so one attempt is always worth it.
- **The resumed activity often doesn't change when the screen does.** Modern apps
  put detail screens, bottom sheets and dialogs in *fragments*, so
  `dumpsys activity activities | grep ResumedActivity` keeps naming the host
  activity while the UI changes completely. Confirm where you are with a
  screenshot, not just the activity name.
- **A tap that "did nothing"** is usually a coordinate-scaling mistake, a tap
  during an animation (add `sleep`), or a tap on padding rather than the
  clickable view. Re-screenshot before concluding the app is broken.
- **`adb shell input text` mangles punctuation** — `/`, `&`, spaces and
  percent-encoding all misbehave, so typing a URL yields garbage. For structured
  values, use the clipboard or seed the app's storage instead (see
  `references/ui-driving.md`).
- **The connect port changes** after a reboot or Wi-Fi drop. When a
  previously-working connection dies, suspect that first — ask for the current
  port rather than re-pairing from scratch. A port you opened yourself with
  `adb tcpip` is the opposite: it never changes, but a reboot wipes it entirely
  and it has to be reopened over the cable.
