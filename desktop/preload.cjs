const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopWidget", {
  hide: () => ipcRenderer.send("widget:hide"),
  openCalculator: () => ipcRenderer.send("widget:open-calculator"),
  isDesktop: true,
  getState: () => ipcRenderer.invoke("widget:get-state"),
  setEnabled: enabled => ipcRenderer.invoke("widget:set-enabled", enabled),
  setAlwaysOnTop: enabled => ipcRenderer.invoke("widget:set-always-on-top", enabled),
  onSpotlight: callback => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on("widget:spotlight", listener);
    return () => ipcRenderer.removeListener("widget:spotlight", listener);
  }
});
