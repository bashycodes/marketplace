## Problem Statement

When I ask Claude to drive my phone through the android-wireless-debug skill, I can't take the phone back. If I need it, or Claude starts doing the wrong thing, any tap or swipe I make competes with Claude's injected input, and Claude keeps going. My only options are to interrupt Claude from the computer, which may be in another room, or to break the connection by hand. Nothing on the phone tells Claude to stop.

## Solution

A physical stop gesture on the phone itself:

- **Press the power button**, or
- **Press volume up, down, up, down quickly.**

Either one halts Claude's control of the phone straight away. Claude refuses to send any further commands to the phone, tells me why, and waits. Control comes back only when I tell Claude to continue. Gestures made before the session started never count. If the watcher can't see the buttons (for example because the connection dropped), Claude stops too, rather than carrying on unwatched.

Tested on a Galaxy S25 (Android 16):

- Both gestures produce clean, distinct raw input events: `KEY_POWER` on `pmic_pwrkey`, `KEY_VOLUMEUP` on `gpio-keys`, `KEY_VOLUMEDOWN` on `pmic_resin`.
- Injected input (`input keyevent`) does not appear on those devices.

## User Stories

1. As a phone owner, I want to press the power button to stop Claude, so that I can take my phone back with one press.
2. As a phone owner, I want to press volume up-down-up-down to stop Claude, so that I can take my phone back without locking it.
3. As a phone owner, I want single volume presses to be ignored, so that I can still adjust the volume while Claude works.
4. As a phone owner, I want the stop to take effect before Claude's next command, so that no further taps land after I've asked it to stop.
5. As a phone owner, I want a batch of taps already running to be cut short, so that a multi-step sequence doesn't keep tapping after I stop it.
6. As a phone owner, I want the stop to stay in place after I unlock or use the phone, so that using my phone doesn't hand control back to Claude.
7. As a phone owner, I want Claude to tell me which gesture stopped it and when, so that I can tell a deliberate stop from an accidental one.
8. As a phone owner, I want to resume by telling Claude to continue, so that a stop is never permanent.
9. As a phone owner, I want gestures made before the session started to be ignored, so that a volume sequence from five minutes earlier doesn't stop a new session.
10. As a phone owner, I want a stop left over from a previous session to be cleared when a new session connects, so that a new session doesn't start stopped.
11. As a phone owner, I want Claude to stop if it can no longer watch the buttons, so that a dropped watcher never leaves Claude in control unwatched.
12. As a phone owner, I want Claude to stay stopped after my computer reboots until a new session reconnects, so that a reboot that wipes the stop state doesn't silently hand control back.
13. As a phone owner, I want Claude to tell me the stop gesture whenever it starts controlling my phone, so that I know how to stop it before I need to.
14. As a phone owner, I want the watcher to stop when the session ends, so that nothing keeps listening to my buttons afterwards.
15. As a phone owner, I want leftover watchers from earlier sessions killed when a new session connects, so that stale processes don't pile up on my phone.
16. As a phone owner, I want only the button devices watched, not the touchscreen, so that what I type and touch is never read or recorded.
17. As a Claude agent, I want my adb commands refused with a clear reason while a stop is in place, so that I stop and report instead of retrying.
18. As a Claude agent, I want reconnecting and checking the watcher to stay allowed while stopped, so that I can recover when the user says continue.
19. As a Claude agent, I want guidance to keep on-device batches short (about 3 s), so that a stop never has to wait behind a long batch.
20. As a skill maintainer, I want the button devices found by name rather than event number, so that the watcher survives reboots that renumber `/dev/input`.
21. As a skill maintainer, I want the watcher's input handling testable from recorded `getevent` output, so that I can verify the gesture rules without a phone.
22. As a skill maintainer, I want the hook's decision testable from a JSON tool call, so that the rules for blocking commands are covered in CI.
23. As a phone owner on a different Android phone, I want a clear message if the button devices can't be found, so that I know the stop gesture isn't available rather than wrongly assuming it is.

## Implementation Decisions

- **Stop watcher (new script in the skill).** It runs in the background on this machine and does three things:
  - Finds the devices that report `KEY_POWER`, `KEY_VOLUMEUP` and `KEY_VOLUMEDOWN` by name, using the device list from `getevent -pl`.
  - Kills any watcher left over from an earlier session.
  - Streams `getevent -lt` from only those devices.
- **Gesture rules:**
  - Any `KEY_POWER DOWN` triggers a stop.
  - Four volume key-downs in the order UP, DOWN, UP, DOWN, spanning no more than about 3 s, also trigger a stop.
  - Any other key-down resets the volume sequence.
  - A single volume press never triggers.
- **Only live events count.** `getevent` reads `/dev/input` live and has no history, so earlier presses can't appear. As a backup, the watcher records the phone's `/proc/uptime` at start and ignores any line with an earlier timestamp.
- **Stop state:**
  - A stop is a single file per machine, not per device: the hook can't tell which phone a command targets (commands use transport ids such as `adb -t 28`, not serials), so a stop blocks all adb.
  - It records the reason (`power`, `volume-sequence`, `watcher-down`) and the wall-clock time.
  - Location: `${XDG_RUNTIME_DIR:-$HOME/.cache}/android-wireless-debug/`, holding `stop` and the watcher's `watcher.pid`.
    - `XDG_RUNTIME_DIR` is readable only by the user and wiped on reboot.
    - The watcher and the hook both derive this path themselves, without relying on anything only Claude's shell knows.
    - `/tmp` is avoided, because other users can create or delete files there.
  - The file persists until it is explicitly resumed.
  - Unlocking the phone, touching it, or reconnecting does not clear it.
- **Stopping in-flight work.** On a stop, the watcher kills this machine's running `adb ... shell` processes for that device, except its own `getevent` stream.
- **Fail-closed.**
  - If the `getevent` stream ends unexpectedly (adb drop, phone reboot), the watcher writes a `watcher-down` stop.
  - The hook also refuses adb when no watcher is running (no `watcher.pid`, or a dead process), treating it as `watcher-down`.
  - This covers cases where no stop file can exist, e.g. after this machine reboots or after the watcher's `stop` command.
- **Enforcement (new PreToolUse hook on Bash in the plugin).**
  - While a stop file exists, the hook refuses any command that invokes `adb`. The reason names the gesture and time and tells Claude to stop, inform the user and wait.
  - Allowed while stopped: the connect script, and the watcher's own status and resume commands.
  - Also refused: commands that delete the stop file directly.
- **Interface: watcher commands.** `start <transport>`, `status`, `resume`, `stop`.
- **Lifecycle changes in the connect script:**
  - Clears any stale stop file for the device.
  - Starts the watcher after a successful connection.
  - Prints the stop gesture next to the existing screenshot and disconnect hints.
- **Skill text changes:**
  - Document the stop gesture and tell Claude to mention it whenever it starts controlling the phone.
  - Only `resume` after an explicit "continue" from the user.
  - Keep on-device batches to about 3 s or less.
  - Run the watcher's `stop` command when finished with the phone.
- **Phones without the buttons.** If no button devices are found, the watcher reports "stop gesture unavailable". The session continues, and Claude must tell the user that the gesture is unavailable.
- **Version bump.** Bump the plugin to 1.2.0 in both the plugin manifest and the marketplace manifest.

## Testing Decisions

- **Test only external behaviour.** Feed in `getevent` text plus tool-call JSON and check whether the command is allowed or refused, and with what reason. Don't assert on internal state or parsing helpers.
- **One seam: a fake `adb` placed first on `PATH`.**
  - It serves recorded `getevent -pl` / `getevent -lt` output and records the commands it receives.
  - The watcher runs against it, then the hook is called with Bash tool-call JSON.
  - The tests assert on the hook's decision and reason. This covers watcher and hook together, end to end.
- **Fixtures** are recorded from the real S25 capture: the device list, the volume sequence, a power press, a cover-the-top-of-the-screen touch, and wake events.
- **Cases:**
  - power triggers a stop
  - the volume sequence triggers a stop
  - the sequence spread over more than 3 s, a wrong order, and single presses do not trigger
  - touchscreen events are ignored
  - a stream ending writes `watcher-down`
  - no watcher running (no pid file, or a stale pid) refuses adb
  - events timestamped before the start are ignored
  - the stop survives later events
  - `resume` clears it
  - connect clears a stale stop
  - the hook allows the connect script and the watcher commands while stopped
  - the hook refuses `rm` of the stop file
  - non-`adb` commands are never blocked
  - no button devices gives the "unavailable" message
- **Prior art:** the shell test for the claude-bells tmux notifier (`check` helper, private temp state, cleanup with `trap`).
  - New tests follow the same style.
  - Add them to CI next to the existing `npm test` step.
- **Manual on-device check (once, not in CI):** confirm that killing this machine's `adb shell` really ends the shell on the phone, so the rest of a batch's taps don't run.

## Out of Scope

- Stopping by touching the screen. Touch events are reliable, but they would mean reading everything typed and touched on the phone.
- Back-tap as a trigger. It's only visible through a Samsung-specific logcat tag that is noisy and could change in an update.
- Covering the proximity sensor. The sensor isn't exposed as an input device; covering it reads as a plain touch.
- Interrupting Claude's own turn. Stopping only blocks phone commands; Claude still finishes its reply.
- Making the gesture configurable (other key sequences, other time windows).
- Phone-side feedback such as a vibration or toast when the stop fires.

## Further Notes

- **Gaps the design accepts:**
  - A power-button stop also locks the phone.
  - The hook blocks the obvious ways of clearing the stop file, but a determined workaround remains possible. The skill's rules are the real guard.
- **Device identification:** device numbers on the S25 were `event3` (power), `event0` (volume up) and `event4` (volume down). They may differ after a reboot, so the watcher must match by name.
- **Phone-side state:** the volume sequence leaves the volume where it started; this was verified.
