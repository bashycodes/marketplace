# grill-over-ticktick evals

These evals talk to a **real TickTick account** if a token file (`~/.config/tt-grill/token`) exists.
Run them with a throwaway HOME so no token is found:
`HOME=$(mktemp -d) claude plugin eval plugins/grill-over-ticktick --allow-tools "Bash(tt-grill *)"`
