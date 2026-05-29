import { contextBridge, shell } from "electron";

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld("electronAPI", {
  openExternal: (url: string) => shell.openExternal(url),
});