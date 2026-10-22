const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, screen, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = app.getAppPath();
const preferencesPath = path.join(app.getPath("userData"), "desktop-preferences.json");
const DEFAULT_PREFERENCES = { widgetEnabled: true, alwaysOnTop: true };
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

let localServer;
let appUrl;
let tray;
let widgetWindow;
let calculatorWindow;
let quitting = false;
let preferences = { ...DEFAULT_PREFERENCES };
let popupTimer;
let popupHideTimer;

function loadPreferences() {
  try {
    preferences = { ...DEFAULT_PREFERENCES, ...JSON.parse(fs.readFileSync(preferencesPath, "utf8")) };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read desktop widget preferences:", error);
  }
}

function savePreferences() {
  try {
    fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
    fs.writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2));
  } catch (error) {
    console.error("Could not save desktop widget preferences:", error);
    throw error;
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Widget enabled",
      type: "checkbox",
      checked: preferences.widgetEnabled,
      click: item => configureWidgetEnabled(item.checked)
    },
    { label: "Show widget now", enabled: preferences.widgetEnabled, click: showWidgetManually },
    { label: "Open work hour calculator", click: openCalculator },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]));
}

function scheduleNextPopup() {
  clearTimeout(popupTimer);
  if (!preferences.widgetEnabled || quitting) return;
  popupTimer = setTimeout(() => {
    if (!preferences.widgetEnabled) return;
    if (widgetWindow && !widgetWindow.isDestroyed() && !widgetWindow.isVisible()) {
      widgetWindow.webContents.send("widget:spotlight", "start");
      widgetWindow.show();
      popupHideTimer = setTimeout(() => {
        if (widgetWindow && !widgetWindow.isDestroyed()) {
          widgetWindow.webContents.send("widget:spotlight", "stop");
          widgetWindow.hide();
        }
        scheduleNextPopup();
      }, 8000);
    } else {
      scheduleNextPopup();
    }
  }, 5 * 60 * 1000 + Math.random() * 10 * 60 * 1000);
}

function showWidgetManually() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  clearTimeout(popupHideTimer);
  widgetWindow.webContents.send("widget:spotlight", "stop");
  widgetWindow.show();
}

function hideWidget() {
  clearTimeout(popupHideTimer);
  widgetWindow?.webContents.send("widget:spotlight", "stop");
  widgetWindow?.hide();
}

function configureWidgetEnabled(enabled) {
  const previous = preferences.widgetEnabled;
  preferences.widgetEnabled = Boolean(enabled);
  try {
    savePreferences();
  } catch (error) {
    preferences.widgetEnabled = previous;
    throw error;
  }
  if (preferences.widgetEnabled) {
    showWidgetManually();
    scheduleNextPopup();
  } else {
    clearTimeout(popupTimer);
    hideWidget();
  }
  refreshTrayMenu();
  return { ...preferences };
}

function configureAlwaysOnTop(enabled) {
  const previous = preferences.alwaysOnTop;
  preferences.alwaysOnTop = Boolean(enabled);
  try {
    savePreferences();
  } catch (error) {
    preferences.alwaysOnTop = previous;
    throw error;
  }
  widgetWindow?.setAlwaysOnTop(preferences.alwaysOnTop, "floating");
  refreshTrayMenu();
  return { ...preferences };
}

function createLocalServer() {
  return new Promise((resolve, reject) => {
    localServer = http.createServer((request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }

      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      } catch {
        response.writeHead(400).end();
        return;
      }

      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      const filePath = path.resolve(appRoot, relativePath);
      if (filePath !== appRoot && !filePath.startsWith(`${appRoot}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }

      fs.stat(filePath, (statError, stats) => {
        if (statError || !stats.isFile()) {
          response.writeHead(404).end("Not found");
          return;
        }

        response.writeHead(200, {
          "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store"
        });
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        fs.createReadStream(filePath).pipe(response);
      });
    });

    localServer.once("error", reject);
    localServer.listen(0, "127.0.0.1", () => {
      const address = localServer.address();
      appUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

function createWidget() {
  const area = screen.getPrimaryDisplay().workArea;
  widgetWindow = new BrowserWindow({
    width: 440,
    height: 258,
    x: area.x + area.width - 460,
    y: area.y + 24,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: preferences.alwaysOnTop,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  widgetWindow.setAlwaysOnTop(preferences.alwaysOnTop, "floating");
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWindow.loadURL(`${appUrl}/desktop/widget.html`);
  widgetWindow.webContents.on("context-menu", event => {
    event.preventDefault();
    Menu.buildFromTemplate([
      {
        label: "Keep widget on top",
        type: "checkbox",
        checked: preferences.alwaysOnTop,
        click: item => configureAlwaysOnTop(item.checked)
      },
      {
        label: "Widget enabled",
        type: "checkbox",
        checked: preferences.widgetEnabled,
        click: item => configureWidgetEnabled(item.checked)
      },
      { type: "separator" },
      { label: "Open work hour calculator", click: openCalculator },
      { label: "Hide widget", click: hideWidget }
    ]).popup({ window: widgetWindow });
  });
  widgetWindow.on("close", event => {
    if (!quitting) {
      event.preventDefault();
      widgetWindow.hide();
    }
  });
}

function openCalculator() {
  clearTimeout(popupHideTimer);
  widgetWindow?.webContents.send("widget:spotlight", "stop");
  if (calculatorWindow && !calculatorWindow.isDestroyed()) {
    calculatorWindow.show();
    calculatorWindow.focus();
    return;
  }

  calculatorWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 760,
    minHeight: 650,
    show: false,
    backgroundColor: "#0d1220",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  calculatorWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  calculatorWindow.loadURL(appUrl);
  calculatorWindow.once("ready-to-show", () => calculatorWindow.show());
  calculatorWindow.on("closed", () => {
    calculatorWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "app.ico"));
  if (icon.isEmpty()) {
    throw new Error("The desktop tray icon could not be loaded from desktop/app.ico.");
  }
  tray = new Tray(icon);
  tray.setToolTip("Work Hour Calculator");
  refreshTrayMenu();
  tray.on("click", () => {
    if (widgetWindow.isVisible()) hideWidget();
    else showWidgetManually();
  });
}

ipcMain.on("widget:hide", hideWidget);
ipcMain.on("widget:open-calculator", openCalculator);
ipcMain.handle("widget:get-state", () => ({ ...preferences }));
ipcMain.handle("widget:set-enabled", (_event, enabled) => configureWidgetEnabled(enabled));
ipcMain.handle("widget:set-always-on-top", (_event, enabled) => configureAlwaysOnTop(enabled));

app.on("before-quit", () => {
  quitting = true;
  clearTimeout(popupTimer);
  clearTimeout(popupHideTimer);
  localServer?.close();
});

app.whenReady().then(async () => {
  loadPreferences();
  await createLocalServer();
  createWidget();
  createTray();
  widgetWindow.once("ready-to-show", () => {
    if (preferences.widgetEnabled) widgetWindow.show();
    scheduleNextPopup();
  });
}).catch(error => {
  console.error("Work Hour Calculator desktop app failed to start:", error);
  dialog.showErrorBox("Unable to start Work Hour Calculator", error.message);
  app.quit();
});
