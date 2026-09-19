# Keyboard navigation

Keyboard preferences live in Settings → Keyboard. Each Nerilo command supports up to three bindings. Select a binding and press its replacement, add an alternative, disable a command, reset one command, or reset everything. Changes persist in the local daemon. Conflicting or reserved bindings are rejected with a reason; an existing command is never silently reassigned.

The shortcut guide is available from the Workspace menu and follows the current settings. Defaults use Command on macOS and Control elsewhere:

| Action                              | Default           |
| ----------------------------------- | ----------------- |
| Search tasks                        | Mod K             |
| New task and focus its message      | Mod J             |
| Toggle sidebar                      | Mod B             |
| Settings                            | Mod ,             |
| Shortcut guide                      | Mod / or ?        |
| Focus message                       | /                 |
| Next / previous area                | F6 / Shift F6     |
| Previous / next sidebar row         | Up / Down         |
| First / last sidebar row            | Home / End        |
| Expand / collapse project           | Right / Left      |
| Task actions                        | Shift F10 or Menu |
| Move sidebar item or queued message | Alt Up / Alt Down |
| Send message                        | Enter             |
| Submit single-line form             | Enter             |
| Submit multiline form               | Mod Enter         |
| Cancel queued-message edit          | Escape            |

Tab and Shift Tab remain standard focus navigation. Native buttons activate with Enter or Space; menus and dialogs close with Escape. Menu arrow navigation and ordinary text editing retain their familiar behavior. These native controls are not application command bindings. Shift Enter inserts a newline; when sending is rebound away from Enter, Enter inserts a newline too.

Workspace shortcuts pause while a menu or dialog is open. Character bindings do not consume text while editing. Composition events are ignored so confirming an IME candidate cannot submit a message. Route changes focus the destination; background polling does not move focus. F6 cycles through the visible navigation, main content, message input, and task details. Mobile navigation traps focus while open and returns it on dismissal.

Focus rings appear for keyboard use. Scrollable code, diffs, terminal output, and file previews can receive focus for keyboard scrolling. Sidebar and queue reordering have keyboard equivalents with announcements. Task menus remain reachable through both pointer context menus and configurable keyboard bindings.
