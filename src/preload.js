'use strict';

// The only bridge between the sandboxed palette UI and the main process.

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, fn) {
  const listener = (_event, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('palitra', {
  search: (query, seq) => ipcRenderer.invoke('palette:search', { query, seq }),
  execute: (payload) => ipcRenderer.invoke('palette:execute', payload),
  icon: (ref) => ipcRenderer.invoke('palette:icon', ref),
  accelerator: (keyEvent) => ipcRenderer.invoke('palette:accelerator', keyEvent),
  info: () => ipcRenderer.invoke('palette:info'),
  hide: () => ipcRenderer.send('palette:hide'),
  onResults: (fn) => subscribe('palette:results', fn),
  onShown: (fn) => subscribe('palette:shown', fn),
  onConfigChanged: (fn) => subscribe('palette:config-changed', fn),
  onTheme: (fn) => subscribe('palette:theme', fn),
  onWorkerRequest: (fn) => subscribe('worker:request', fn),
  workerRespond: (payload) => ipcRenderer.send('worker:response', payload),
});
