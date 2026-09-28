# Diagnostics: making the device tell you what is wrong

Everything here assumes `D="adb -t <transport_id>"`.

The theme running through this file: **do not infer from source what the device
can state as fact.** Most of these commands take seconds and replace an entire
chain of reasoning.

## Contents

- [Window forensics](#window-forensics)
- [Edge-to-edge and system bar insets](#edge-to-edge-and-system-bar-insets)
- [Theme and configuration](#theme-and-configuration)
- [Logcat](#logcat)
- [Crashes and ANRs](#crashes-and-anrs)
- [Package, version and permission state](#package-version-and-permission-state)
- [Inspecting the APK you actually installed](#inspecting-the-apk-you-actually-installed)

## Window forensics

```bash
$D shell dumpsys window windows | grep -A 20 "MyActivity"
```

The single most informative command for any layout bug. Read for:

| Field | Tells you |
|---|---|
| `Frames: ... frame=[0,0][1080,2340]` | the window's actual size. If it equals the full display, you are edge-to-edge |
| `layoutInDisplayCutoutMode` | `always` means the window extends into the notch/cutout region |
| `mAttrs={... fl=... pfl=...}` | window flags — fullscreen, translucent bars, etc. |
| `mFullConfiguration` | `night`, locale, density (`450dpi`), size buckets (`sw384dp`), orientation |
| `mHasSurface` / `isVisible` | whether it is actually on screen, versus merely existing |

`mFullConfiguration` is the quiet hero: it settles theme, density and size-class
questions outright.

## Edge-to-edge and system bar insets

Apps targeting SDK 35+ get edge-to-edge with no opt-out, so a window that fills
the display is expected — the bug is usually that the app never *consumed* the
insets, leaving its header under the status bar and its bottom controls under the
navigation bar.

Confirm the geometry:

```bash
$D shell dumpsys window displays | grep -iE "cutout|DisplayFrames"
$D shell wm size; $D shell wm density
```

`initCutout=DisplayCutout{insets=Rect(0, 71 - 0, 0) ...}` gives the exact cutout
inset in pixels — compare it against where the app's content actually starts in a
screenshot. If content begins at y=0 while the cutout inset is 71, the app is not
applying insets.

Two follow-on traps once a fix applies padding:

- Padding the content root exposes whatever is *behind* it — often the host
  theme's window background, in the wrong colour, showing as strips behind the
  bars.
- Some OEM skins (One UI in particular) still honour the deprecated
  `setStatusBarColor` / `setNavigationBarColor`, so bar colours may need setting
  explicitly even on versions where the docs describe them as no-ops.

## Theme and configuration

```bash
$D shell cmd uimode night          # -> "Night mode: yes" | "no"
$D shell cmd uimode night no       # force light  (RESTORE THIS AFTERWARDS)
$D shell cmd uimode night yes      # force dark
```

Toggling is the fastest way to check both themes, and the fastest way to leave
someone's phone in the wrong mode. Restore it immediately and say that you did.

A theme mismatch — app dark, your screen light — is nearly always the app reading
the wrong signal. The `night` token in the activity's own `mFullConfiguration` is
authoritative: it is what the framework is actually rendering with. Theme
attributes (`colorBackground`, `windowBackground`) reflect whatever theme the
component was *declared* against, which for an activity pinned to a fixed theme
can be permanently light no matter what the rest of the app does. Code that
checks the attribute first and the configuration only as a fallback will
confidently report the wrong answer.

Other configuration levers worth testing:

```bash
$D shell settings put system font_scale 1.30        # large text
$D shell wm density 560                             # denser display; `wm density reset` undoes it
```

These persist. Write down what you changed before you change it.

## Logcat

```bash
$D logcat -c                                  # clear, so the buffer holds only what follows
# ... perform the action ...
$D logcat -d | grep -iE "mytag|exception"     # dump and filter
$D logcat -d -v time | tail -100              # with timestamps
```

Clear-act-dump gives a tight window instead of scrolling megabytes of unrelated
system chatter.

**The toast trick.** Toast lines identify their caller, with a line number:

```
I Toast   : show: caller = com.example.WebhookHooks.onMenuClick:119
```

That is free proof a specific code path executed, without adding any logging of
your own. If the app toasts anywhere, you already have a probe. The same
principle applies to any framework log that records a caller or stack.

Useful filters:

```bash
$D logcat -d --pid=$($D shell pidof -s com.example)   # just this app
$D logcat -d -b crash                                  # crash buffer only
$D logcat -d '*:E'                                     # errors and above
```

## Crashes and ANRs

```bash
$D logcat -d -b crash | tail -60
$D shell dumpsys activity exit-info com.example        # why the process last died
$D shell ls /data/anr/                                 # ANR traces (may need root)
```

`exit-info` is the quickest answer to "it just disappeared" — it distinguishes a
crash from a low-memory kill from the user swiping the app away.

## Package, version and permission state

```bash
$D shell dumpsys package com.example | grep -E "versionName|versionCode|targetSdk|minSdk"
$D shell dumpsys package com.example | grep -A 20 "requested permissions"
$D shell pm list packages | grep example
$D shell pm path com.example                       # where the APK(s) live on device
```

Check `versionCode` after every install. It is the cheapest way to catch the
classic waste-an-hour mistake: debugging a build the device never actually
received, because the install silently failed or you rebuilt into a different
path than the one you installed from.

Read `targetSdk` early. It governs edge-to-edge enforcement, permission
behaviour and background limits, and is frequently the reason something behaves
differently on-device than you expected from the source.

## Inspecting the APK you actually installed

Especially valuable when the APK is generated, patched or repackaged and you need
to prove what is inside the artifact on the phone, rather than what you believe
you built:

```bash
# On the build machine, before installing
aapt2 dump badging app.apk | grep -E "^package|native-code|densities"
aapt2 dump resources app.apk | grep my_resource_name

# Pull back what is actually installed
$D shell pm path com.example                 # -> package:/data/app/.../base.apk
$D pull /data/app/.../base.apk installed.apk
unzip -o -q installed.apk 'classes*.dex' -d dexes/
dexdump -d dexes/classes2.dex | grep -A 5 "MyClass.myMethod"
```

`native-code` must intersect `adb shell getprop ro.product.cpu.abilist`, or the
install fails with `INSTALL_FAILED_NO_MATCHING_ABIS`. Modern flagships
(Snapdragon 8 Gen 3 and later) are **64-bit only**, so an `armeabi-v7a`-only
build will never install on them no matter how cleanly it compiled and signed.

Signing checks, when an install is rejected as incompatible:

```bash
apksigner verify -v --print-certs app.apk | grep -E "Verified using|certificate DN"
```

A certificate different from the installed copy's means Android will refuse to
update in place. The only path is uninstall-then-install, which erases app data —
tell the user before doing it.
