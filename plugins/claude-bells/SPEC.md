# Claude Bells — attention notifications for Claude Code in WSL + tmux

Status: packaged as a Claude Code plugin (claude-bells). The original design was verified live; the 😴/🔔 split and clear-on-any-tool are verified on a scratch window only, with the live check pending.

## Problem Statement

I run several Claude Code sessions at once. Each one runs inside WSL on a Windows machine, inside tmux, and sometimes that tmux session is reached over SSH. A session often works for minutes before it finishes, asks me a question or needs a permission. Nothing tells me when that happens. I have to keep cycling through tmux windows to check, and I either waste time polling or leave a session idle long after it needed me. Even when I find an idle session, I can't tell at a glance whether it's simply done or blocked on a decision from me.

These layers make it harder:

- Claude Code runs in Linux, but the thing I'm looking at is a Windows desktop app (Windows Terminal), or a different machine when I'm connected over SSH.
- tmux sits between Claude and the terminal. Terminal-level signals have to pass through it, and it multiplexes many windows, so an alert must say which window needs me.
- I don't want alerts for a session I'm already looking at. That's noise.

The first working version was wired by hand on one machine: hook entries edited into the Claude settings, a script copied into place, and tmux and Windows Terminal settings changed. Repeating that on another machine, or handing it to someone else, meant redoing every step and knowing every pitfall.

## Solution

When a Claude Code session needs me, that is, it finished its turn, asked a question or is waiting on a permission prompt, two things happen, unless I'm already looking at that exact pane:

1. **A badge appears on that window's tab in the tmux status bar.** It's 😴 when Claude finished its turn, and 🔔 when it asked a question or wants a permission. It stays until I respond or Claude starts working again, so it reliably marks "this session is idle and waiting for you", and says whether it's merely done or blocked on me.
2. **A terminal bell rings in that pane.** tmux turns it into a highlight: the window's tab shows inverted, grey, if it isn't the current window. tmux also forwards the bell to the outer terminal. Windows Terminal then flashes its taskbar icon if it isn't the foreground app. Over SSH, the bell reaches whatever terminal I'm connecting from.

The whole thing runs on signals that already exist: Claude Code hooks, tmux options and bells, and Windows Terminal's bell setting. It needs no software beyond the plugin itself and no third-party services. Because the bell is just a byte on the terminal stream, it crosses SSH for free.

### Packaging

It ships as a Claude Code plugin, `claude-bells`, in a public plugin marketplace, and installs in two steps:

1. **Install the plugin from the marketplace.** It brings the hook script and the hook wiring, which replace the hand-edited hook entries and hand-copied script of the first version. The script does nothing outside tmux, so installing the plugin is harmless for someone who doesn't use tmux.
2. **Run `/claude-bells:setup` once.** tmux and terminal settings live outside anything a plugin can install, so this user-invoked skill wires them: the badge in the tmux status bar, the tmux focus and bell options, and the terminal's bell setting. It also removes hook entries left over from a hand-wired install, so alerts don't fire twice, and ends with a check on a scratch window.

### Behavior matrix

When an alert fires and I'm **not** looking at the pane:

| Where I am | Badge (😴/🔔) on tab | Tab greys (tmux bell highlight) | Taskbar flashes |
|---|---|---|---|
| Another tmux window, Windows Terminal focused | yes | yes | no |
| Another Windows app, Claude's window is tmux's current window | yes | no (tmux never flags the current window) | yes |
| Another Windows app, on another tmux window | yes | yes | yes |
| Connected over SSH | yes | yes | depends on the SSH client's terminal bell setting |

"Looking at the pane" means all three hold: it's the active pane, in the session's active window, and a tmux client attached to that session has terminal focus. In that case nothing happens at all: no badge and no bell.

### Clearing rules

| Indicator | Clears when |
|---|---|
| Grey tab highlight | I switch to that tmux window (tmux built-in) |
| Taskbar flash | Windows Terminal comes to the foreground (Windows built-in) |
| Badge (😴 or 🔔, whatever the reason) | I submit a prompt in that session, Claude runs any tool, or I press prefix `a` in that window |

Just looking at a window does **not** clear the badge. That's intentional: the badge means "idle and waiting for you", not "unseen". When I've seen it and want it gone without replying, prefix `a` dismisses it by hand.

Claude waking itself up (a background task finishing, a monitor firing, a scheduled wakeup) and running tools also clears the badge. That's intended too: while Claude is working there's nothing for me to do. When it stops again, the Stop hook puts 😴 back, unless I'm looking at the pane.

## User Stories

1. As a Claude Code user running many sessions in tmux, I want to be told when a session finishes its turn, so that I can respond without polling every window.
2. As a Claude Code user, I want to be told when a session asks me a question, so that it isn't blocked waiting on me unnoticed.
3. As a Claude Code user, I want to be told when a session is blocked on a permission prompt, so that long tasks don't stall silently mid-turn.
4. As a Claude Code user, I want to be told when an MCP server asks for input (elicitation), so that those dialogs don't stall silently either.
5. As a tmux user, I want the waiting window marked in my status bar, so that I know *which* of many windows needs me.
6. As a tmux user, I want a session that simply finished its turn marked 😴, so that I can see it's done and idle without mistaking it for one that's stuck.
7. As a tmux user, I want a session that asked a question or wants a permission marked 🔔, so that I can see it's blocked on me and deal with it first.
8. As a tmux user, I want an unknown or missing reason to show no mark at all, so that a stale or mistyped value never renders a misleading badge.
9. As a tmux user, I want the mark to persist until I respond or Claude starts working again, so that briefly passing through a window doesn't lose track of a waiting session.
10. As a tmux user, I want the mark to clear automatically when I respond, so that I never clean up indicators by hand.
11. As a tmux user, I want the mark gone whenever Claude is working, even when it woke itself up (background tasks finishing, monitors firing, scheduled wakeups), so that the badge only ever means "idle and waiting for me".
12. As a tmux user, I want the mark to come back when a self-woken Claude stops again, so that I don't lose the alert just because Claude did some work in between.
13. As a tmux user, I want answering a question or approving a permission to clear the mark, so that the badge doesn't stay stale while Claude resumes work.
14. As a tmux user, I want the badge to fit my existing status-bar theme, for both the current and inactive window formats, so that it looks native.
15. As a tmux user, I want tmux's own bell highlight (inverted tab) on the waiting window, so that I get a visual cue even without the badge.
16. As a Windows user, I want the Windows Terminal taskbar icon to flash when I'm in another app, so that I notice a waiting session without keeping the terminal in view.
17. As a Windows user, I want every Windows Terminal profile I might open WSL in to flash on a bell, so that the alert doesn't depend on which profile a tab was started from.
18. As a user who is already looking at the session, I want no alert at all, so that I'm not pestered about something I can see.
19. As a user who switches to another tmux window while Windows Terminal stays focused, I want the badge and the tab highlight, so that I still see which window needs me.
20. As a user who switches to another Windows app, I want the taskbar flash plus the badge, so that I'm pulled back and land on the right window.
21. As a user attached over SSH, I want the same signals to reach my SSH client's terminal, so that remote work gets alerts without a separate setup.
22. As a user running Claude Code outside tmux, I want the hooks to do nothing silently, so that non-tmux sessions aren't broken or noisy.
23. As a user, I want the alert to add no noticeable delay to Claude's turn, so that responsiveness doesn't suffer.
24. As a user, I want the feature to need no installs beyond the plugin, no accounts and no third-party services, so that nothing about my sessions leaves my machine.
25. As a user, I want to avoid duplicate alerts for one event, so that alerts stay meaningful. For that reason the 60-second "still idle" reminder is not hooked.
26. As a user, I want subagents finishing to not alert me, so that I'm only interrupted when the *main* session needs me.
27. As a user, I want the alert logic to fail open when tmux can't report terminal focus, so that I get an alert rather than miss one.
28. As a user with several Claude sessions, I want each session's alert to target only its own window, so that the badge points at the right place.
29. As a user, I want a written breakdown of what each signal means and when it clears, so that I can read the indicators at a glance.
30. As a user, I want the reason-to-emoji mapping kept only in my own tmux config, apart from the plugin, so that I can change a symbol without touching the plugin.
31. As a future maintainer (a person or an agent), I want this spec to capture the decisions and their reasons, so that I can rebuild or extend the plugin without rediscovering the pitfalls.
32. As a Claude Code user, I want to install the Claude side with one command from the marketplace, so that I don't hand-edit hook entries into my Claude settings or copy a script into place.
33. As a tmux user, I want one setup command, `/claude-bells:setup`, to wire my tmux config and my terminal's bell setting while keeping my existing status-bar formats, and to tell me which setting to change when it can't configure my terminal itself, so that the parts no plugin can install are still one step away.
34. As a Claude Code user who doesn't use tmux, I want the plugin to stay inert, so that installing it costs me nothing.
35. As a user of the earlier hand-wired version, I want setup to remove my old hook entries, so that moving to the plugin doesn't make every alert fire twice.
36. As a tmux user, I want a prefix key that clears the badge on the current window, so that I can dismiss a session I've noticed but won't answer yet without sending it a prompt.

## Implementation Decisions

### Modules

- **Hook script (the only runtime logic).** A small bash script shipped in the plugin, invoked by Claude Code hooks, with two commands:
  - `alert <reason>`, where the reason is `stop`, `ask` or `perm` (default `stop`). If the pane isn't being looked at, it sets the window's tmux user option `@claude_waiting` to the reason and writes a BEL byte to the pane's tty. The bell rings the same for all three reasons.
  - `clear` unconditionally unsets `@claude_waiting` on the window.
  - It records only the reason and knows nothing about emoji.
  - It always drains the hook's stdin JSON payload first. It exits 0 without doing anything if `TMUX` or `TMUX_PANE` is unset or tmux isn't on PATH, so the plugin is inert outside tmux.
- **Hook wiring, shipped by the plugin.** Installing the plugin wires every session where it's enabled. It replaces the hook entries the first version had hand-edited into the user's Claude settings:

  | Claude Code event | Matcher | Command |
  |---|---|---|
  | Stop | (all) | `alert stop` |
  | Notification | `permission_prompt\|elicitation_dialog` | `alert perm` |
  | PreToolUse | `AskUserQuestion` | `alert ask` |
  | UserPromptSubmit | (all) | `clear` |
  | PostToolUse | (all) | `clear` |

  Each hook has a 5-second timeout.
- **tmux status format, in the user's tmux config.** One shared user option, `@claude_badge`, maps the reason to an emoji with one explicit conditional per reason: `stop` → 😴, `ask` → 🔔, `perm` → 🔔; any other value, or unset, → nothing. Both `window-status-format` and `window-status-current-format` expand `@claude_badge` after the window name, so the mapping lives in one place. The user's existing theme is otherwise unchanged. The same config binds prefix `a` to `set -wu @claude_waiting`, which clears the badge on the current window by hand; it's plain tmux and doesn't call the hook script. Once setup writes it, the mapping lives only in the user's tmux config; the hook script never reads it, so users can change the emoji without touching the plugin. The tmux settings this relies on are `focus-events on`, `monitor-bell on`, `bell-action any`, plus tmux's defaults `visual-bell off` and `window-status-bell-style reverse`.
- **Windows Terminal bell style.** The profile defaults use `bellStyle: "taskbar"`, so a BEL flashes the taskbar icon when Windows Terminal isn't the foreground window, in every profile that doesn't set its own bell style.
- **Setup skill (user-invoked).** Everything outside Claude Code is wired by the plugin's setup skill, which runs only when the user invokes it. It:
  - finds the user's tmux config and adds the `@claude_badge` mapping plus the badge reference in both window-status formats, preserving the user's existing formats;
  - binds prefix `a` to clear the badge, or asks for another key if `a` is taken;
  - turns `focus-events` on, checks that `monitor-bell` is on and `bell-action` is `any`, then reloads tmux;
  - on WSL with Windows Terminal, sets the profile-defaults `bellStyle` to `taskbar`; for any other terminal, tells the user which setting makes the terminal react to a bell;
  - removes pre-plugin, hand-wired hook entries that call a notify-tmux script, so alerts don't fire twice;
  - ends with a check on a scratch window.

### Badge state machine

| Current `@claude_waiting` | Event | New value | Shown |
|---|---|---|---|
| any | Stop, and pane not being looked at | `stop` | 😴 |
| any | AskUserQuestion about to run, and pane not being looked at | `ask` | 🔔 |
| any | Permission prompt or elicitation, and pane not being looked at | `perm` | 🔔 |
| any | User submits a prompt | unset | nothing |
| any | Any tool finishes (PostToolUse) | unset | nothing |
| any | User presses prefix `a` in that window | unset | nothing |

Why any tool run clears every badge: the badge means "Claude is idle and waiting for me", so it has no business showing while Claude works. That includes Claude waking itself up: the badge disappears while it works, and the Stop hook re-marks the window with 😴 when it finishes, unless I'm looking at the pane. The reason is still recorded, but only to pick the emoji.

History: in live testing, a background task woke Claude after a turn ended, Claude ran tools, and PostToolUse erased the badge while I was away. At first that was treated as a bug and fixed with a reason-tagged rule: tool runs cleared only `ask` / `perm`, and a `stop` badge survived until I submitted a prompt. It was rolled back at my request. Losing the badge during self-initiated work is intended, because it comes back at the next Stop.

### Other decisions

- **Focus detection** is done through tmux, not Windows. The pane counts as being looked at when `pane_active` and `window_active` are both set and some client attached to the session has the `focused` client flag. That flag is reported because tmux `focus-events` is on and Windows Terminal sends focus in/out events. This works the same over SSH, because the SSH client's terminal reports focus to tmux. If the flag is never reported, the check fails and the alert fires (fail open).
- **Looking at the pane suppresses both badge and bell**, not just the bell. That's what I expected: nothing should appear while I'm watching. Trade-off: if I look away after the turn ends but before replying, no badge appears later.
- **The bell is written to the pane's tty, not to the hook's stdout.** Claude Code captures hook stdout, so a BEL printed there would never reach the terminal. The script asks tmux for the pane's tty and writes the byte there. One BEL byte doesn't disturb Claude Code's fullscreen TUI.
- **The badge is a per-window tmux user option**, not a per-pane one, because the status bar shows windows. Two Claude panes in one window share one badge.
- **The emoji depends on the reason**, so I can tell "done" (😴) from "blocked on me" (🔔) at a glance. The mapping lives in tmux config, not the script: the script stores only the reason, and tmux decides how each reason looks.
- **The mapping names all three reasons explicitly**, even though `ask` and `perm` currently look the same. Either can get its own symbol later with a one-line change, and an unexpected value renders nothing instead of a wrong badge.
- **Signal routing** is tmux → outer terminal via `bell-action any`, so a bell in any window of the session reaches attached clients. Windows Terminal then applies its own bell style, and over SSH so does the client's terminal.
- **The 60-second `idle_prompt` Notification is deliberately not hooked**, because it would double-alert after every Stop.
- **SubagentStop is not hooked**: only the main session's needs matter.
- **`AskUserQuestion` is hooked through PreToolUse** rather than relying on Notification, because it's unclear whether that tool raises a Notification event. If both fire, the two BELs coincide and look like one alert.
- **Scope follows the plugin install.** Installed at user scope, the plugin applies to every session in every repo, as the hand-wired user-level hooks did.
- **The plugin ships the hooks and the script; setup wires the rest.** A plugin can't install tmux or terminal settings, and silently editing a user's tmux config at install time or at session start would be surprising. So that wiring is an explicit, user-invoked setup skill.
- **Migration from the hand-wired version.** Its hook entries in the user's Claude settings would fire alongside the plugin's and ring every alert twice. Setup removes them, and the plugin's script takes over from the hand-copied one.

## Testing Decisions

- **What makes a good test:** drive the system only through its public command interface and observe only externally visible state. The public interface is the hook script's `alert <reason>` and `clear`, given `TMUX` and `TMUX_PANE` and a JSON payload on stdin. The visible state is the window's `@claude_waiting` value, tmux's `window_bell_flag`, and the rendered status format. Don't test how the script computes focus internally.
- **Where the tests live:** at the marketplace repo root, outside the plugin directory, so plugin installs stay lean.
- **Seam 1, the hook script's command interface (highest seam, most of the coverage):**
  - Run everything against an isolated tmux server on a private socket, with `TMUX` pointed at it, so the tests never touch the user's real sessions.
  - Create a detached window on that server. Being detached makes it "not looked at" without needing to change focus.
  - Run each command with `TMUX_PANE` pointed at it.
  - Check: `alert stop|ask|perm` sets the matching value and raises `window_bell_flag`; `alert` with no reason defaults to `stop`; `clear` clears every reason, `stop` included. Then kill the window.
  - Also check: running outside tmux (with `TMUX` and `TMUX_PANE` unset) exits 0 and does nothing.
  - Give the isolated server the badge mapping and format references that setup writes, then render both status formats with `#{E:window-status-format}` and `#{E:window-status-current-format}` against windows marked `stop`, `ask`, `perm`, an unknown value, and unset. Expect 😴, 🔔, 🔔, nothing, nothing.
  - Run the clear-key command that setup writes on a marked window, and expect the mark gone.
- **Seam 2, plugin install and setup, tested live in a session:**
  - Validate the plugin's hook config and list each event → command mapping. After setup, confirm no hand-wired notify-tmux hook entries remain in the user's Claude settings.
  - Run setup and confirm its closing scratch-window check passes.
  - Prove the PostToolUse wiring is live: set the badge in one tool call and read it in the next. It must be cleared for every reason, `stop` included.
  - Hooks reload lazily. The first check after installing, updating or rewiring may still run the old hook, so re-run it once.
- **Seam 3, manual end-to-end through the matrix:** with a live Claude session, make Claude wait until tmux reports the target focus state, then end its turn right away without further tool calls. The target states are: on another tmux window with Windows Terminal focused; and on another tmux window with another Windows app focused. Confirm what appears (badge, grey tab, taskbar flash) and that each clears as the clearing rules say. Also let a background task wake Claude while a 😴 badge is up: the badge should vanish while Claude works and return when it stops.
- **Prior art:** the hand-wired version had no automated test suite; its checks were ad-hoc shell pipe-tests plus live-session verification. Seam 1 is now the automated suite. Seams 2 and 3 stay manual and should be repeated after any change to the script, the hook wiring or setup.

## Out of Scope

- **Native Windows toast notifications** (for example through PowerShell). I considered and declined these: they only show on the Windows machine's own screen, so they're useless when I'm connected over SSH from elsewhere.
- **Phone push through a third-party relay** (for example ntfy.sh). I declined it for now; it's a natural future addition for alerts while away from any terminal.
- **Claude Code's built-in mobile push for input-needed events.** Not configured here; it only covers prompts and questions, not turns finishing.
- **Terminal escape-sequence desktop notifications (OSC 9 / OSC 777 / OSC 99).** Windows Terminal isn't a target for them, and through tmux they'd need passthrough enabled.
- **Sound.** Windows Terminal's bell style is taskbar-only; there's no audible bell.
- **Per-pane badges** when several Claude sessions share one tmux window.
- **Alerting for subagents** or for the 60-second idle reminder.
- **Re-alerting** if I look away after a suppressed alert.
- **Editing tmux or terminal config automatically**, at install time or at session start. Setup is explicit and user-invoked.
- **Configuring terminals other than Windows Terminal.** For those, setup only tells the user which setting makes the terminal react to a bell.

## Further Notes

- After installing or updating the plugin, or after setup removes old hook entries, sessions that were already running may need a restart or opening `/hooks` once before they pick up the change.
- Over SSH, the taskbar-flash equivalent depends entirely on the SSH client's terminal. The badge and the grey tab are tmux-side and always work.
- Hooks can't tell whether Claude woke up because of me or because of a background event. By design that doesn't matter: any tool run clears the badge, and the next Stop re-marks it. Don't bring back a "`stop` survives tool runs" rule without asking; it was tried and rolled back.
- To change a symbol, edit the `@claude_badge` mapping in your tmux config and reload it. The plugin needs no change.
