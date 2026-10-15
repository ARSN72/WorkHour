# Work Hour Calculator

A responsive, local-first work time calculator built with HTML, CSS, and vanilla JavaScript ES modules. It is suitable for GitHub Pages and stores records in the current browser using `localStorage`.

## Features

- Live digital clock and live work countdown.
- Manual start and optional end time.
- 8-hour, 9-hour, 7.5-hour, or custom target.
- First-half and second-half modes, each equal to half the selected full-day target.
- Quick break presets (10, 20, 30, 60 minutes) and custom breaks.
- Net elapsed work, remaining work, estimated exit, overtime, and “If I leave now”.
- Separate record per calendar date; switching dates loads that date's data.
- History, CSV export, dark mode, responsive mobile layout.
- Shortcut to open Keka attendance logs; clock-out remains a manual confirmation on Keka.
- Optional service-worker cache for offline access after first load.
- No backend, account, analytics, build step, or third-party dependency.

## Project structure

```text
shiftmate/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── main.js
│   └── modules/
│       ├── date-time.js
│       ├── storage.js
│       ├── calculator.js
│       ├── dom.js
│       ├── clock.js
│       ├── breaks.js
│       ├── history.js
│       └── theme.js
├── manifest.json
├── sw.js
└── README.md
```

### Module responsibilities

- `main.js`: application controller, events, rendering, day switching.
- `modules/date-time.js`: parsing, formatting, local date/time helpers.
- `modules/storage.js`: versioned localStorage repository and record normalization.
- `modules/calculator.js`: pure shift-duration, break, target, overtime calculations.
- `modules/dom.js`: DOM lookup, toast notifications, numeric validation.
- `modules/clock.js`: live digital clock/date display.
- `modules/breaks.js`: break rendering and add/remove operations.
- `modules/history.js`: daily history and CSV export.
- `modules/theme.js`: dark mode preferences.

## Publish to GitHub Pages

1. Create a repository, for example `shiftmate`.
2. Upload all files and folders to the repository root. Keep `index.html` at the root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select your default branch (usually `main`) and `/ (root)`, then save.
6. Open the published URL shown on that page.

The app uses native JavaScript modules, so test it through GitHub Pages or a local HTTP server instead of opening the HTML as a `file://` URL.

## Local preview

With Python installed, run this from the project directory:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Calculation assumptions

- Breaks are excluded from the work target by default.
- Enable **Count breaks toward work target** if your policy includes breaks.
- Estimated exit = start time + target + breaks excluded from work duration.
- A manually entered end time marks the session completed.
- An end time earlier than the start time is interpreted as a shift crossing midnight.
- Half-day mode uses exactly half of the selected full-day target.
- An unfinished record from a previous date is frozen at that date's midnight boundary; it is not silently marked completed.
- “If I leave now” is a projection, not a saved clock-out.

## Data and limitations

- Data stays in the current browser profile; it does not sync across devices.
- Browser storage can be cleared. Use **Export CSV** for a backup.
- This is a personal calculator, not an official attendance record. Confirm actual attendance and company policy separately.
- GitHub Pages is static hosting and cannot directly access a private Keka session or API.
- Browser same-origin protections prevent this app from clicking buttons inside Keka. The Keka shortcut opens its attendance page in a new tab for manual clock-out.
