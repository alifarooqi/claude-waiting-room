---
"@waiting-room/sdk": minor
---

`createActivity` accepts `activityPane: null` to subscribe without a tmux pane binding (for activities that aren't terminal panes, e.g. web pages served by a bridge). The default env-derived `$TMUX_PANE` behavior is unchanged, and an explicit pane string is now also supported.
