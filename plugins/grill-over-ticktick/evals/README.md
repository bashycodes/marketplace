# grill-over-ticktick evals

These evals talk to a **real TickTick account** if a token file (`~/.config/tt-grill/token`, or `$XDG_CONFIG_HOME/tt-grill/token`) exists.
Run them with a throwaway HOME and without `TICKTICK_TOKEN` (it wins over any token file) or `XDG_CONFIG_HOME` (it moves the token file) so no token is found:
`env -u TICKTICK_TOKEN -u XDG_CONFIG_HOME HOME=$(mktemp -d) claude plugin eval plugins/grill-over-ticktick --allow-tools "Bash(tt-grill *)"`
