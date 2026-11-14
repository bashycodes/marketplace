---
type: llm
weight: 2
---
Look at the resolution commit (titled `wayfinder(demo-map): resolve 01 …`). Fail if it does not exist. Pass only if it contains only .scratch/demo-map/map.md and .scratch/demo-map/issues/01-choose.md: the pre-staged notes.txt must NOT be in it. Fail if git add -A, git add ., git commit -a or git push was run.
