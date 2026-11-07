# Work Hour Calculator

A private, local-first work time calculator built with HTML, CSS, and vanilla JavaScript. Run it in a browser or as a Windows desktop app with an always-on-top clock widget and system-tray controls.

## Features

- Live digital clock and shift countdown.
- Manual clock-in and clock-out times, with a current-time shortcut.
- 8-hour, 9-hour, 7.5-hour, or custom work targets; optional half-day mode.
- Preset and custom break tracking.
- Net work, elapsed time, remaining time, estimated exit, overtime, and “If I leave now” calculations.
- A separate saved record per calendar date, with recent history and CSV export.
- Dark interface and responsive browser layout.
- Windows tray app with a compact clock widget, work summary, and full calculator window.
- Optional reminders that bring rotating shift details to the front for 8 seconds every 5–15 minutes.
- No backend, account, or analytics.

## Run the Windows desktop app

### Requirements

- Windows 10 or newer.
- Node.js 20 or newer with npm.

### Start from the project folder

Open PowerShell in the project folder (the folder containing `package.json`) and run:

```powershell
npm install
npm start
```

The first command installs the app dependencies; it is only needed once, or after dependencies change. The second command starts the desktop widget. Keep the terminal open while running this way.

### One-click launch

After Node.js is installed, double-click **Run Work Hour Calculator.bat** in the project folder. It will find the standard Windows Node.js installation, install dependencies if Electron is not installed yet, and start the app. Keep the console window open while the widget is running; closing the console exits the app.

To run it again later, open PowerShell in the same folder and run:

```powershell
npm start
```

If PowerShell says that `npm` or `node` is not recognized, install Node.js from [nodejs.org](https://nodejs.org/), then close and reopen PowerShell (and VS Code, if using its terminal). Check that both commands are available:

```powershell
node --version
npm --version
```

### Use the widget and tray

- The widget appears near the top-right of the desktop and shows the current time, clock-in, expected or actual clock-out, break total, net work, and total elapsed time.
- Right-click the widget to change **Keep widget on top**, enable or disable it, open the full calculator, or hide it.
- Click the tray icon to show or hide the widget. Right-click the tray icon for the widget toggle, **Show widget now**, calculator, and **Quit** options.
- In the desktop calculator, use **Enable desktop widget and scheduled summaries** to turn the widget and reminders on or off.
- When enabled, the widget briefly appears every 5–15 minutes and rotates through break, elapsed time, net work, and clock-out summaries. Manually showing the widget keeps it open until you hide it.

The app does not currently start automatically when Windows starts.

### Build a Windows installer

From PowerShell in the project folder, run:

```powershell
npm install
npm run dist
```

The installer is created under `dist`. Install it once, then launch **Work Hour Calculator** from the Windows Start menu in future sessions. The installer is not code-signed, so Windows may show a security prompt when it is first run.

## Run the browser version

The browser version can be previewed locally or published as a static website.

### Local preview

With Python installed, open PowerShell in the project folder and run:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>. Stop the local server with `Ctrl+C`.

Do not open `index.html` directly as a `file://` URL: JavaScript modules and offline support need an HTTP server.

### Publish to GitHub Pages

1. Upload the project files and folders to the repository root; keep `index.html` at the root.
2. Open **Settings → Pages** in the GitHub repository.
3. Choose **Deploy from a branch**, select the default branch and `/ (root)`, then save.
4. Open the published URL shown in the Pages settings.

The browser version does not provide a Windows tray widget; use the desktop app for that.

## Load the Chrome extension

The Chrome extension opens a compact work tracker from the browser toolbar. Its files are grouped in `chrome-extension/`, separate from the website and Electron desktop app. The popup shows elapsed work, remaining time, and estimated exit at the top, with **Live** and **Custom** navigation at the bottom. **Live** refreshes from Keka when a Keka page loads or refreshes and shows today's clock-in, worked time, breaks, and estimated exit. When Keka provides punch details, elapsed work excludes breaks and the exit estimate adds the recorded breaks to the configured target; without punch details, the popup labels break data unavailable. The daily work target is configured in **Custom** and supports the available preset, custom-hour, and half-day options. Keka data is read-only and does not change Custom records. History browsing, CSV export, and advanced settings are not included in the popup.

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the [`chrome-extension`](./chrome-extension/) folder (the folder containing the extension's `manifest.json`).
4. Pin **Work Hour Calculator** from Chrome's Extensions menu for quick access.

Reload the extension from `chrome://extensions` after updating its files. Open the popup from the pinned Chrome toolbar icon; do not open `popup.html` through a local web server, because Chrome extension APIs such as local storage are available only in the installed extension context. Keka access is optional: in **Live**, click **Connect / refresh Keka** once and allow Chrome's request to read `walkover.keka.com`. The extension calls Keka's attendance endpoint from the signed-in Keka page, using its current browser session and access token; tokens and cookies are never saved by the extension. Once access is granted, Keka page loads and refreshes update the Live panel automatically. If asked, sign in to Keka and refresh attendance again. Keka data does not change Custom data. The extension's own records are stored locally and are separate from the website and Windows desktop app; they do not sync between devices.

The extension folder is self-contained so Chrome can load it independently. Its `js/modules/` folder contains the shared date/time, calculation, and storage modules used by the popup; keep these copies aligned with the corresponding files in the project-level `js/modules/` folder when changing shared behavior.

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
├── chrome-extension/
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   ├── service-worker.js
│   └── js/
│       └── modules/
│           ├── date-time.js
│           ├── storage.js
│           └── calculator.js
├── desktop/
│   ├── main.cjs
│   ├── preload.cjs
│   ├── widget.html
│   ├── widget.css
│   └── widget.js
├── manifest.json
├── sw.js
├── package.json
└── README.md
```

- `js/main.js` coordinates the calculator UI, saved daily records, and event handling.
- `js/modules/calculator.js` contains shift and break calculations.
- `js/modules/storage.js` saves and normalizes local records.
- `chrome-extension/` contains the self-contained Manifest V3 extension; load this folder in Chrome's **Load unpacked** picker.
- The root `manifest.json` is the installable browser site's web app manifest.
- `desktop/main.cjs` manages the Electron windows, tray, reminders, and local-only app server.
- `desktop/widget.*` implements the compact desktop widget and its summary display.
- `desktop/app.ico` is the Windows tray and installer icon.

## Calculation assumptions

- Breaks are excluded from required work by default. Enable **Count breaks toward work target** if your policy includes breaks.
- Estimated exit equals clock-in + work target + breaks excluded from work time.
- Entering an end time marks a session complete. An end time earlier than the start time is treated as an overnight shift.
- Half-day mode uses half the selected full-day target.
- An unfinished past-day record is frozen at that date's midnight boundary; it is not silently marked complete.
- “If I leave now” is a projection, not a saved clock-out.

## Data and limitations

- Records are stored locally in browser storage and do not sync between devices. The desktop app, regular browser version, and Chrome extension have separate storage.
- Browser storage can be cleared. The browser app can export CSV; the Chrome popup does not yet include export, so its records have no built-in backup.
- This is a personal calculator, not an official attendance system. Confirm attendance and company policy separately.
- GitHub Pages cannot access a private Keka session or API. The Keka link opens its attendance page; clock-out must be confirmed there by the user.
- The desktop widget displays the saved work summary but does not control Keka or interact with other applications.
