# DipMeet (v1.1)

DipMeet is the Chrome extension for people who want meetings to happen on their schedule, not by accident. It helps you jump into meetings at the right moment, leave exactly when you should, and keep the tab clutter under control.

It supports two main workflows:

- A circular timer that auto-closes the current tab after the duration you choose
- A meeting scheduler that opens supported meeting links at `Join at` and exits them at `Leave at`

## Features

- A fun circular hours-and-minutes slider for quick current-tab timing
- Manual `Join at`/`Leave at` scheduling for Google Meet, Teams, and Zoom links
- Google Calendar import from the active event tab when a supported meeting link is present
- Automatic meeting open and leave scheduling via `chrome.alarms`
- Best-effort pre-join mute, camera-off, and join automation on supported pages
- Live countdown for active tab timers with `Cancel` and `+5 min` controls
- Recent local history so you can revisit past timer and meeting sessions
- Light mode by default, with a matching dark mode for late-night focus

## Use cases

- Don’t feel like attending a meeting manually? Set it and forget it.
- Need to leave a call right on time? DipMeet exits the meeting for you.
- Want to stay focused during work blocks? Timer-start on the current tab and avoid lingering.
- Running a back-to-back day? Schedule meetings in advance so your browser handles the rest.
- Using Google Calendar and want fewer manual clicks? Import an event and let DipMeet do the timing.

## Project Structure

- `manifest.json`: extension manifest, permissions, and host access
- `src/background.js`: tab timer alarms, meeting scheduling, Google Calendar import, and meeting automation orchestration
- `src/popup.html`: popup layout
- `src/popup.css`: popup styling and circular slider visuals
- `src/popup.js`: popup interaction logic for the timer and meeting scheduler
- `src/lib/`: shared constants, storage helpers, tab helpers, and meeting helpers

## Load Locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this `DipMeet` folder.

## Behavior

- The timer mode always targets the current active tab when you press `Start timer`.
- The meeting mode stores a scheduled meeting job and uses alarms to open and leave it later.
- Google Calendar import currently starts from the active Google Calendar web tab and extracts a supported meeting link from the visible event context.
- Meeting automation reliability is best on Google Meet. Teams and Zoom are implemented with best-effort web automation and can fail safely if their UI does not match expected selectors.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
