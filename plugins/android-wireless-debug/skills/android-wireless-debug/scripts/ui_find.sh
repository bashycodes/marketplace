#!/usr/bin/env bash
# ui_find.sh <transport_id> <text substring> [nth]
# Prints "X Y" — the device-pixel centre of the first matching node.
# Matches against text, content-desc and resource-id, case-insensitively.
# Exits 1 and lists visible text if nothing matches, so a miss is diagnosable.
set -uo pipefail
TID="$1"; NEEDLE="$2"; NTH="${3:-0}"
D="adb -t $TID"
$D shell uiautomator dump /sdcard/_uif.xml >/dev/null 2>&1
$D exec-out cat /sdcard/_uif.xml > /tmp/_uif.xml 2>/dev/null
$D shell rm -f /sdcard/_uif.xml >/dev/null 2>&1
python3 - "$NEEDLE" "$NTH" <<'PY'
import re, sys, xml.etree.ElementTree as ET
needle, nth = sys.argv[1].lower(), int(sys.argv[2])
try:
    root = ET.parse('/tmp/_uif.xml').getroot()
except Exception as e:
    print("dump parse failed: %s" % e, file=sys.stderr); sys.exit(1)
hits, all_text = [], []
for n in root.iter('node'):
    hay = " ".join(n.get(k, '') for k in ('text', 'content-desc', 'resource-id'))
    if n.get('text'): all_text.append(n.get('text'))
    if needle in hay.lower():
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds', ''))
        if m:
            l, t, r, b = map(int, m.groups())
            if r > l and b > t:
                hits.append(((l + r) // 2, (t + b) // 2))
if len(hits) > nth:
    print("%d %d" % hits[nth])
else:
    print("no match for %r (found %d)." % (needle, len(hits)), file=sys.stderr)
    print("visible text:", file=sys.stderr)
    for t in all_text[:40]:
        print("   %s" % t, file=sys.stderr)
    sys.exit(1)
PY
