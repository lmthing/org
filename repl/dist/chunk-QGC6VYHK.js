// src/spaces/watcher.ts
import { watch } from "fs/promises";
import { join } from "path";
async function watchSpaces(options) {
  const { spacesDir, onChange, debounceMs = 300, recursive = true } = options;
  let watching = true;
  let abortController = new AbortController();
  let timeoutMap = /* @__PURE__ */ new Map();
  function getSpaceName(filePath) {
    const relative = filePath.replace(spacesDir, "").replace(/^[\/\\]+/, "");
    const segments = relative.split(/[\/\\]/);
    if (segments.length === 0) return null;
    const spaceName = segments[0];
    return spaceName;
  }
  const watcher = watch(spacesDir, {
    recursive,
    signal: abortController.signal
  });
  (async () => {
    try {
      for await (const event of watcher) {
        if (!watching) break;
        const eventType = event.eventType;
        const filename = event.filename;
        if (!filename) continue;
        const fullPath = join(spacesDir, filename);
        const spaceName = getSpaceName(fullPath);
        if (!spaceName) continue;
        const existing = timeoutMap.get(spaceName);
        if (existing) {
          clearTimeout(existing);
        }
        const timeout = setTimeout(async () => {
          try {
            await onChange(spaceName);
          } catch (err) {
            console.error(`Error reloading space ${spaceName}:`, err);
          }
          timeoutMap.delete(spaceName);
        }, debounceMs);
        timeoutMap.set(spaceName, timeout);
      }
    } catch (err) {
      if (err.name === "AbortError") {
      } else {
        console.error("Space watcher error:", err);
      }
    }
  })();
  return {
    async stop() {
      watching = false;
      abortController.abort();
      for (const timeout of timeoutMap.values()) {
        clearTimeout(timeout);
      }
      timeoutMap.clear();
    },
    isWatching: () => watching
  };
}
function isFileWatchingSupported() {
  try {
    return typeof watch === "function";
  } catch {
    return false;
  }
}

export {
  watchSpaces,
  isFileWatchingSupported
};
