# Driving the UI

Everything here assumes `D="adb -t <transport_id>"` from the connect step.

## Contents

- [Screenshots and the coordinate trap](#screenshots-and-the-coordinate-trap)
- [Finding elements without guessing pixels](#finding-elements-without-guessing-pixels)
- [Taps, swipes and keys](#taps-swipes-and-keys)
- [Typing text (and why it mangles URLs)](#typing-text-and-why-it-mangles-urls)
- [Launching and navigating apps](#launching-and-navigating-apps)
- [Knowing which screen you are on](#knowing-which-screen-you-are-on)
- [Scripting a repeatable path](#scripting-a-repeatable-path)
- [Recording video](#recording-video)

## Screenshots and the coordinate trap

```bash
$D exec-out screencap -p > shot.png
```

`exec-out` streams raw bytes. Plain `shell` pushes the PNG through a pty and
corrupts it — if the image comes out broken, that is why.

When you view the PNG, the tool reports something like *"original 1080x2340,
displayed at 923x2000, multiply coordinates by 1.17"*. Tap coordinates must be in
**device** pixels:

```
device_x = measured_x * ratio
device_y = measured_y * ratio
```

Skipping this puts every tap slightly up and to the left. The symptom is a tap
that appears to do nothing, which looks exactly like an unresponsive app — so you
end up debugging the app instead of your arithmetic. If a tap misses, check the
multiplication before anything else.

## Finding elements without guessing pixels

Measuring off a screenshot is fine for a few taps, but for anything repeated,
resolve the element by name. `scripts/ui_find.sh` does the dump-and-parse and
prints a tap-ready centre, matching on text, content-desc or resource-id:

```bash
scripts/ui_find.sh 7 "Revert Task"     # -> "207 1102"
$D shell input tap $(scripts/ui_find.sh 7 "Revert Task")
```

On a miss it exits non-zero and prints the screen's visible text, so you can see
what it *did* find instead of guessing why a tap went nowhere. Combine it with a
scroll loop to reach offscreen items:

```bash
find_tap() {                       # find_tap "Webhooks"
  for i in 1 2 3 4 5; do
    if XY=$(scripts/ui_find.sh "$T" "$1" 2>/dev/null); then $D shell input tap $XY; return 0; fi
    $D shell input swipe 540 1800 540 1000 250; sleep 1.5
  done
  return 1
}
```

This is worth reaching for early. Coordinates recorded even one session ago drift
as content and layouts change; resolving by name absorbs that silently, and turns
"the tap did nothing" into a clear error naming what was on screen.

Raw form, if you want the whole hierarchy:

```bash
$D shell uiautomator dump /sdcard/window_dump.xml
$D pull /sdcard/window_dump.xml .
grep -o 'text="[^"]*"[^>]*bounds="[^"]*"' window_dump.xml | head -40
```

`bounds="[left,top][right,bottom]"` is already in device pixels, so an element's
centre is `((left+right)/2, (top+bottom)/2)` — no scaling, no eyeballing. This is
the reliable way to hit a small control, and it also tells you whether an element
exists at all, which distinguishes "my tap missed" from "the view was never
added".

Caveat: `uiautomator dump` fails or returns stale content while animations run,
and some apps or secure windows refuse it. Fall back to screenshots.

## Taps, swipes and keys

```bash
$D shell input tap 540 1200
$D shell input swipe 540 1800 540 900 300        # x1 y1 x2 y2 duration_ms
$D shell input keyevent KEYCODE_BACK             # also HOME, ENTER, TAB, DEL
```

Put a `sleep 1`–`3` after anything that starts a transition. Tapping during an
animation lands wherever the view was mid-flight, which produces irreproducible
results — the same script "works sometimes", the most expensive failure mode to
chase.

Swipe duration controls behaviour in inertial lists: ~300 ms over 900 px is a
controlled scroll, ~50 ms is a fling.

### Two timing rules that are easy to get backwards

**Opening a panel and tapping inside it must not share a command.** A
swipe-to-open-drawer followed by a tap on something in that drawer, in the same
Bash invocation, lands while the panel is still animating and silently does
nothing. Splitting them across two commands adds enough latency to work — but the
robust fix is to *probe* rather than guess:

```bash
$D shell input swipe 5 1200 700 1200 300      # open drawer
scripts/ui_find.sh "$T" settings_btn          # non-zero until it is really there
```

Then tap. The probe both waits and tells you the current coordinate.

**But when you need two actions close together, batch them in ONE `adb shell`.**
Each separate `adb` invocation costs a few hundred milliseconds of round-trip, so
consecutive commands land seconds apart — which quietly makes any timing-window
test meaningless. Everything inside a single `shell` string runs on-device with
no host round-trip in between:

```bash
# two dispatches ~1.2s apart — inside a 1.5s de-dup window
$D shell 'input tap 1006 1299; sleep 0.6; input tap 207 1102; sleep 0.5; input tap 1006 1299; sleep 0.6; input tap 207 1102'
```

Keep each batch short, about 3 seconds at most. The user's stop gesture (see
SKILL.md) is only checked between commands, so a long batch would make them wait.

If you are testing a debounce, de-dup or rate-limit window, always measure the
actual gap from the receiving end (payload timestamps, server logs) rather than
assuming your taps were as fast as they felt.

## Typing text (and why it mangles URLs)

```bash
$D shell input text 'hello%sworld'     # %s is a space
```

`input text` passes through the shell and then a key-event encoder. Spaces must
be written `%s`, and `&`, `?`, `%`, `<`, `>`, `|` and quotes need escaping or
arrive wrong. In practice `:` and `/` usually survive, so a plain
`https://host/path` often types cleanly — but "usually" is not "always", so
verify rather than trust it.

**Verify with a hierarchy dump, not a screenshot.** Single-line fields scroll to
their tail once the text overflows the box, so a screenshot shows
`site/8589cee0-…` and tells you nothing about whether the `https://webhook.`
prefix survived. The dump gives you the field's real value:

```bash
$D shell uiautomator dump /sdcard/w.xml && $D pull /sdcard/w.xml .
grep -o 'text="[^"]*"' w.xml | grep -i "http"
```

If the value must be exactly right, prefer setting it where it is stored: for a
debuggable app, `adb shell run-as <pkg>` gives access to its data dir, so you can
write the preference file directly and restart the app.

On an emulator you can write an app's `shared_prefs` XML as root, but fix
ownership afterwards (`chown` to the app's uid from
`stat -c %u /data/data/<pkg>`, then `restorecon`) or the app silently ignores the
file.

## Launching and navigating apps

```bash
$D shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER com.example | tail -1   # -> com.example/.MainActivity
$D shell am start -n com.example/.MainActivity      # launch it; exported activities only
$D shell am force-stop com.example                  # force a cold start next time
```

`am start` on a **non-exported** activity is refused:

```
SecurityException: Permission Denial: starting Intent { ... } not exported from uid 10512
```

That is the platform working correctly — internal screens are deliberately not
addressable from the shell. Navigate through the app's own UI instead. It is
still worth one attempt, since exported activities start fine and save a lot of
tapping.

`resolve-activity` finds the app's entry point the same way the home screen
does, so you do not need to know the activity name; the home screen then starts
it explicitly, and so should you. Two shortcuts that look equivalent and aren't:

- `am start -a MAIN -c LAUNCHER -p <pkg>` — implicit `am start` only matches
  activities that also declare `CATEGORY_DEFAULT`. Many launcher activities
  don't, so it fails with "unable to resolve Intent" on some apps and works on
  others.
- `monkey -p <pkg> ... 1` — launches fine, but turns auto-rotate on as it exits,
  flipping the user's rotation setting behind their back.

## Knowing which screen you are on

```bash
$D shell dumpsys activity activities | grep -E "ResumedActivity" | head -2
```

**This misleads more often than you would expect.** Modern apps host detail
screens, bottom sheets and dialogs as *fragments* inside one activity, so the
resumed activity keeps naming the host while the visible UI changes completely.
Treat it as a coarse signal — "am I still in this app" — and confirm the actual
screen with a screenshot.

## Scripting a repeatable path

Once you know the route to the screen under test, collapse it into one command:

```bash
D="adb -t 5"
$D shell am start -n "$($D shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER com.example | tail -1 | tr -d '\r')" >/dev/null 2>&1
sleep 5
$D shell input tap 76 172;   sleep 2      # open drawer
$D shell input tap 825 221;  sleep 3      # settings
$D shell input swipe 540 1800 540 900 300; sleep 2
$D shell input tap 199 1767; sleep 3      # the screen under test
$D exec-out screencap -p > after.png
```

This matters for two reasons. Each rebuild-and-check cycle becomes a single
command instead of a dozen round trips; and because every run starts from the
launcher and follows identical coordinates, any difference in the resulting
screenshot is a real change in the app rather than drift in how you navigated.
Comment each tap with what it hits — six-deep coordinate chains are unreadable a
day later, and you will want to re-run them.

**These chains rot, and not only when the starting screen differs.** Coordinates
that cross any list of *user data* — a task list, an inbox, a feed — silently
break as soon as that data changes, because the rows move. A chain recorded on
Monday can land on the wrong row on Tuesday and leave you somewhere plausible but
wrong, which is worse than failing outright. Two habits make this cheap:

- Route through screens whose layout is fixed (settings hierarchies) rather than
  through data-dependent lists wherever you have the choice.
- Screenshot at the end of every chain and confirm you are where you expected,
  before acting on what you find. If it drifted, step through with a screenshot
  after each tap and re-record.

## Recording video

For motion, gestures, or a transient state a screenshot misses:

```bash
$D shell screenrecord --time-limit 15 /sdcard/rec.mp4
$D pull /sdcard/rec.mp4 .
$D shell rm /sdcard/rec.mp4
```

Cannot capture secure surfaces (DRM, some keyboards); no audio.
