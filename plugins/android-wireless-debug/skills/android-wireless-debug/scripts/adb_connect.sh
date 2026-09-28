#!/usr/bin/env bash
# Connect to an Android device for debugging, cheapest route first.
#
# Usage:
#   adb_connect.sh                                # auto: known port -> USB bootstrap -> pairing
#   adb_connect.sh --usb                          # force the USB bootstrap
#   adb_connect.sh <ip[:port]>                    # connect straight to a known address
#   adb_connect.sh <ip:pairPort> <code>           # pair with a 6-digit code, then connect
#   adb_connect.sh <ip:port> <ip:pairPort> <code> # pair on one port, connect on another
#
# Env:
#   ADB_TCP_PORT   port adbd listens on in legacy TCP mode (default 54321)
#   ADB_DEVICE_IP  device address. Defaults to the default gateway, which IS the
#                  phone when this machine is on the phone's hotspot.
#   ADB_WIN        path to a Windows platform-tools adb.exe (WSL only)
set -uo pipefail

PORT="${ADB_TCP_PORT:-54321}"
say() { printf '%s\n' "$*" >&2; }

device_ip() {
  if [ -n "${ADB_DEVICE_IP:-}" ]; then echo "$ADB_DEVICE_IP"; return; fi
  ip route 2>/dev/null | awk '/^default/{print $3; exit}'
}

port_open() { timeout 2 bash -c "echo > /dev/tcp/$1/$2" 2>/dev/null; }

# An already-attached wireless device, if any: "ip:port".
attached_tcp() { adb devices | awk 'NF==2 && $1 ~ /:[0-9]+$/ && $2=="device" {print $1; exit}'; }

# A USB device: "serial state".
attached_usb() { adb devices | awk 'NF==2 && $1 !~ /:[0-9]+$/ {print $1, $2; exit}'; }

transport_for() {
  adb devices -l | awk -v c="$1" '$1==c {
    for (i=1;i<=NF;i++) if ($i ~ /^transport_id:/) { sub(/transport_id:/,"",$i); print $i; exit }
  }'
}

connect_to() {
  local addr="$1" out
  out=$(adb connect "$addr" 2>&1); say "    $out"
  adb devices | grep -q "^${addr}[[:space:]]\+device$"
}

report() {
  local addr="$1" tid D
  tid=$(transport_for "$addr")
  if [ -z "$tid" ]; then say "connected to $addr but no transport id; see: adb devices -l"; return 1; fi
  D="adb -t $tid"
  echo
  echo "connected: $addr"
  echo "transport id: $tid"
  echo "use:  D=\"adb -t $tid\""
  echo
  echo "==> device"
  printf '  android : %s (sdk %s)\n' "$($D shell getprop ro.build.version.release | tr -d '\r')" \
                                     "$($D shell getprop ro.build.version.sdk | tr -d '\r')"
  printf '  model   : %s\n' "$($D shell getprop ro.product.model | tr -d '\r')"
  printf '  serial  : %s\n' "$($D shell getprop ro.serialno | tr -d '\r')"
  printf '  abis    : %s\n' "$($D shell getprop ro.product.cpu.abilist | tr -d '\r')"
  printf '  screen  : %s / %s\n' "$($D shell wm size | tr -d '\r')" "$($D shell wm density | tr -d '\r')"
  printf '  night   : %s\n' "$($D shell cmd uimode night | tr -d '\r')"
  echo
  echo "screenshot:  $D exec-out screencap -p > shot.png"
  echo "disconnect:  adb disconnect $addr      # leaves the port open on the phone"
}

# --- route 1: a TCP port the phone is already listening on -------------------
try_tcp() {
  local addr="$1"
  case "$addr" in *:*) ;; *) addr="$addr:$PORT" ;; esac
  local host="${addr%:*}" p="${addr##*:}"
  [ -n "$host" ] || return 1
  say "==> trying $addr"
  port_open "$host" "$p" || { say "    no listener on $p"; return 1; }
  connect_to "$addr" && { CONNECTED="$addr"; return 0; }
  return 1
}

# --- route 2: bootstrap the TCP port over USB --------------------------------
win_adb() {
  local c
  # Never /mnt/c/Windows/adb.exe — that stray is usually adb 1.0.32 and its
  # daemon fails outright.
  for c in "${ADB_WIN:-}" /mnt/c/Users/*/platform-tools/adb.exe \
           "/mnt/c/Program Files/platform-tools/adb.exe"; do
    [ -n "$c" ] && [ -f "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

usb_bootstrap() {
  local wadb usb serial state ip cand tries
  if [ -d /mnt/c/Windows ]; then
    # WSL has no USB stack: only a Windows-side adb server can see the cable.
    # With networkingMode=Mirrored both sides share 127.0.0.1:5037, so once the
    # Windows server is up, the Linux client here drives it.
    if ! wadb=$(win_adb); then
      say "no Windows platform-tools found. Install them with:"
      say "  cd /mnt/c/Users/\$USER && curl -L -o platform-tools.zip \\"
      say "    https://dl.google.com/android/repository/platform-tools-latest-windows.zip && unzip -oq platform-tools.zip"
      return 1
    fi
    say "==> starting the Windows adb server ($wadb)"
    adb kill-server >/dev/null 2>&1
    "$wadb" devices -l >/dev/null 2>&1
  fi

  usb=$(attached_usb); serial="${usb%% *}"; state="${usb##* }"
  if [ -z "$serial" ]; then
    say "no USB device. Plug the cable in, and check USB debugging is on."
    return 1
  fi
  if [ "$state" != "device" ]; then
    say "device $serial is '$state'. Unlock the phone and tap 'Allow USB debugging?'"
    say "(tick 'Always allow from this computer'). If no dialog appears, replug, or"
    say "Developer options > Revoke USB debugging authorisations, then replug."
    return 1
  fi

  say "==> $serial over USB; switching adbd to TCP port $PORT"
  adb -s "$serial" tcpip "$PORT" || return 1

  # adbd restarts, so poll rather than sleep. The phone's own addresses cover
  # the case where it is not this machine's gateway.
  for tries in 1 2 3 4 5 6 7 8; do
    for cand in $(device_ip) \
                $(adb -s "$serial" shell ip -4 -o addr show scope global 2>/dev/null \
                  | awk '{split($4,a,"/"); print a[1]}' | tr -d '\r'); do
      if port_open "$cand" "$PORT" && connect_to "$cand:$PORT"; then
        CONNECTED="$cand:$PORT"
        say "==> up on $CONNECTED. Unplug the cable whenever you like."
        return 0
      fi
    done
  done
  say "adbd restarted on $PORT but nothing answered. Is this machine on the phone's network?"
  return 1
}

# --- route 3: Android 11+ pairing --------------------------------------------
pair_and_connect() {
  local pair_addr="$1" code="$2" connect_addr="${3:-}" mdns
  say "==> pairing with $pair_addr"
  # Pass the code as an argument: without it adb prompts and blocks forever.
  if ! adb pair "$pair_addr" "$code"; then
    say "pairing failed — the code expires when the phone's dialog closes."
    say "ask for a freshly opened pairing dialog, and check you used the pairing"
    say "port rather than the connect port (they are different)."
    return 1
  fi
  if [ -n "$connect_addr" ]; then
    connect_to "$connect_addr" && { CONNECTED="$connect_addr"; return 0; }
    return 1
  fi
  # Pairing and connecting use *different* ports, and only the pairing one was
  # given. Recover the connect port from mDNS: a phone with Wireless debugging
  # open advertises _adb-tls-connect._tcp. Often adb has already auto-connected.
  mdns=$(adb devices | awk 'NF==2 && $1 ~ /_adb-tls-connect/ && $2=="device" {print $1; exit}')
  if [ -n "$mdns" ]; then
    say "==> auto-connected via mDNS: $mdns"
    CONNECTED="$mdns"; return 0
  fi
  mdns=$(adb mdns services 2>/dev/null | awk '$2 ~ /_adb-tls-connect/ {print $3; exit}')
  if [ -n "$mdns" ]; then
    say "==> connect port from mDNS: $mdns"
    connect_to "$mdns" && { CONNECTED="$mdns"; return 0; }
  fi
  say "paired, but the connect port is unknown and mDNS did not find it."
  say "Ask for the IP:PORT on the main Wireless debugging screen — a different"
  say "port from the pairing dialog — and pass it as arg 1:"
  say "  $0 <IP:PORT> $pair_addr <code>   (with a freshly opened dialog)"
  return 1
}

pairing_instructions() {
  cat >&2 <<'MSG'

Nothing to connect to. Ask the user for Android 11+ wireless debugging:

  Settings > Developer options > Wireless debugging  (phone must be a Wi-Fi
  *client* — the toggle is greyed out on a hotspot-only phone with Wi-Fi off)

  1. "Pair device with pairing code" -> gives IP:PAIR_PORT and a 6-digit code
  2. the main screen                 -> gives IP:PORT (a different port)

Then:  adb_connect.sh <IP:PAIR_PORT> <code>
       adb_connect.sh <IP:PORT> <IP:PAIR_PORT> <code>   # if the code auto-connect fails

If the phone cannot be a Wi-Fi client (hotspot on, Wi-Fi off), use the cable
instead:  adb_connect.sh --usb
MSG
}

CONNECTED=""
case "${1:-}" in
  --usb|-u) usb_bootstrap && report "$CONNECTED"; exit $? ;;
  -h|--help) sed -n '2,20p' "$0" >&2; exit 0 ;;
esac

if [ $# -ge 2 ] && [[ "$2" =~ ^[0-9]{6}$ ]]; then
  pair_and_connect "$1" "$2" && report "$CONNECTED"; exit $?
fi
if [ $# -ge 3 ]; then
  pair_and_connect "$2" "$3" "$1" && report "$CONNECTED"; exit $?
fi
if [ $# -ge 1 ]; then
  try_tcp "$1" && { report "$CONNECTED"; exit 0; }
  say "could not reach $1"; exit 1
fi

# auto
existing=$(attached_tcp)
if [ -n "$existing" ]; then
  say "==> already attached: $existing"
  report "$existing"; exit 0
fi
try_tcp "$(device_ip)"  && { report "$CONNECTED"; exit 0; }
usb_bootstrap           && { report "$CONNECTED"; exit 0; }
pairing_instructions
exit 1
