export async function getCurrentActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  const tab = tabs.find((candidate) => typeof candidate.id === "number" && !candidate.url?.startsWith("chrome://"));
  if (!tab) {
    return null;
  }

  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || "Untitled tab",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl || ""
  };
}

export async function findBestMatchingTab(savedTimer) {
  if (!savedTimer) {
    return null;
  }

  const exactMatch = await chrome.tabs.get(savedTimer.tabId).catch(() => null);
  if (exactMatch && typeof exactMatch.id === "number") {
    return {
      id: exactMatch.id,
      windowId: exactMatch.windowId,
      title: exactMatch.title || savedTimer.title || "Untitled tab",
      url: exactMatch.url || savedTimer.url || "",
      favIconUrl: exactMatch.favIconUrl || savedTimer.favIconUrl || ""
    };
  }

  const allTabs = await chrome.tabs.query({});
  const fallback = allTabs.find((tab) => {
    if (typeof tab.id !== "number" || tab.url?.startsWith("chrome://")) {
      return false;
    }

    return tab.url === savedTimer.url && tab.title === savedTimer.title;
  });

  if (!fallback) {
    return null;
  }

  return {
    id: fallback.id,
    windowId: fallback.windowId,
    title: fallback.title || savedTimer.title || "Untitled tab",
    url: fallback.url || savedTimer.url || "",
    favIconUrl: fallback.favIconUrl || savedTimer.favIconUrl || ""
  };
}
