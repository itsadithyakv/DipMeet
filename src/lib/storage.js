import { HISTORY_LIMIT, STORAGE_KEYS } from "./constants.js";

export async function getTheme() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.theme);
  return data[STORAGE_KEYS.theme] ?? "light";
}

export async function setTheme(theme) {
  await chrome.storage.local.set({ [STORAGE_KEYS.theme]: theme });
}

export async function getActiveTimer() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.activeTimer);
  return data[STORAGE_KEYS.activeTimer] ?? null;
}

export async function setActiveTimer(timer) {
  await chrome.storage.local.set({ [STORAGE_KEYS.activeTimer]: timer });
}

export async function clearActiveTimer() {
  await chrome.storage.local.remove(STORAGE_KEYS.activeTimer);
}

export async function getHistory() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.history);
  return data[STORAGE_KEYS.history] ?? [];
}

export async function pushHistoryEntry(entry) {
  const history = await getHistory();
  const nextHistory = [entry, ...history].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ [STORAGE_KEYS.history]: nextHistory });
  return nextHistory;
}

export async function getMeetingJobs() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.meetingJobs);
  return data[STORAGE_KEYS.meetingJobs] ?? [];
}

export async function setMeetingJobs(jobs) {
  await chrome.storage.local.set({ [STORAGE_KEYS.meetingJobs]: jobs });
}

export async function getActiveMeetingSession() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.activeMeetingSession);
  return data[STORAGE_KEYS.activeMeetingSession] ?? null;
}

export async function setActiveMeetingSession(session) {
  await chrome.storage.local.set({ [STORAGE_KEYS.activeMeetingSession]: session });
}

export async function clearActiveMeetingSession() {
  await chrome.storage.local.remove(STORAGE_KEYS.activeMeetingSession);
}
