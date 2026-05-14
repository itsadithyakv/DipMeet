import { MEETING_JOB_STATUS, MEETING_PLATFORM, TIMER_STATUS } from "./lib/constants.js";
import { getHistory, getTheme, setTheme } from "./lib/storage.js";
import { getCurrentActiveTab } from "./lib/tabs.js";
import { detectMeetingPlatform } from "./lib/meetings.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_HOURS = 12;
const MAX_MINUTES = 59;

const state = {
  activeTimer: null,
  meetingJobs: [],
  activeMeetingSession: null,
  currentTab: null,
  selectedHours: 0,
  selectedMinutes: 15,
  setupUnit: "hours",
  draggingRing: false,
  activePointerId: null,
  switchAnimationHandle: null,
  importedMeetingDraft: null,
  tickHandle: null
};

const elements = {
  body: document.body,
  statusPill: document.querySelector("#status-pill"),
  ringLabel: document.querySelector("#ring-label"),
  ringInner: document.querySelector("#progress-ring-inner"),
  timerEmpty: document.querySelector("#timer-empty"),
  timerLive: document.querySelector("#timer-live"),
  liveUrl: document.querySelector("#live-url"),
  timeLeft: document.querySelector("#time-left"),
  closeAt: document.querySelector("#close-at"),
  progressRing: document.querySelector("#progress-ring"),
  progressRingKnob: document.querySelector("#progress-ring-knob"),
  selectedTabTitle: document.querySelector("#selected-tab-title"),
  selectedTabSubtitle: document.querySelector("#selected-tab-subtitle"),
  selectedTabFavicon: document.querySelector("#selected-tab-favicon"),
  selectedTabFallback: document.querySelector("#selected-tab-fallback"),
  startTimer: document.querySelector("#start-timer"),
  cancelTimer: document.querySelector("#cancel-timer"),
  addFiveMinutes: document.querySelector("#add-five-minutes"),
  meetingUrl: document.querySelector("#meeting-url"),
  meetingJoinAt: document.querySelector("#meeting-join-at"),
  meetingLeaveAt: document.querySelector("#meeting-leave-at"),
  meetingPlatformBadge: document.querySelector("#meeting-platform-badge"),
  importCalendar: document.querySelector("#import-calendar"),
  scheduleMeeting: document.querySelector("#schedule-meeting"),
  meetingQueue: document.querySelector("#meeting-queue"),
  queueList: document.querySelector("#queue-list"),
  meetingSession: document.querySelector("#meeting-session"),
  meetingSessionTitle: document.querySelector("#meeting-session-title"),
  meetingSessionUrl: document.querySelector("#meeting-session-url"),
  meetingSessionJoinAt: document.querySelector("#meeting-session-join-at"),
  meetingSessionLeaveAt: document.querySelector("#meeting-session-leave-at"),
  meetingSessionStatus: document.querySelector("#meeting-session-status"),
  cancelMeetingJob: document.querySelector("#cancel-meeting-job"),
  themeToggle: document.querySelector("#theme-toggle"),
  historyToggle: document.querySelector("#history-toggle"),
  historySheet: document.querySelector("#history-sheet"),
  closeHistory: document.querySelector("#close-history"),
  historyList: document.querySelector("#history-list"),
  pickHours: document.querySelector("#pick-hours"),
  pickMinutes: document.querySelector("#pick-minutes")
};

async function initialize() {
  bindEvents();
  setSetupUnit("hours", false);
  await Promise.all([loadTheme(), refreshCurrentTab(), refreshExtensionState(), renderHistory()]);
  if (!state.activeTimer) {
    renderIdleTimer();
  }
  startClock();
}

function bindEvents() {
  elements.startTimer.addEventListener("click", handleStartTimer);
  elements.cancelTimer.addEventListener("click", handleCancelTimer);
  elements.addFiveMinutes.addEventListener("click", handleAddFiveMinutes);
  elements.themeToggle.addEventListener("click", handleThemeToggle);
  elements.historyToggle.addEventListener("click", () => toggleHistory(true));
  elements.closeHistory.addEventListener("click", () => toggleHistory(false));
  elements.pickHours.addEventListener("click", () => setSetupUnit("hours", true));
  elements.pickMinutes.addEventListener("click", () => setSetupUnit("minutes", true));
  elements.progressRing.addEventListener("pointerdown", handleRingPointerDown);
  window.addEventListener("pointermove", handleRingPointerMove);
  window.addEventListener("pointerup", handleRingPointerUp);
  window.addEventListener("pointercancel", handleRingPointerUp);
  elements.meetingUrl.addEventListener("input", renderMeetingPlatformBadge);
  elements.importCalendar.addEventListener("click", handleImportCalendar);
  elements.scheduleMeeting.addEventListener("click", handleScheduleMeeting);
  elements.cancelMeetingJob.addEventListener("click", handleCancelMeetingJob);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.activeTimer || changes.meetingJobs || changes.activeMeetingSession) {
      void refreshExtensionState();
    }

    if (changes.history) {
      void renderHistory();
    }

    if (changes.theme) {
      applyTheme(changes.theme.newValue ?? "light");
    }
  });
}

async function loadTheme() {
  applyTheme(await getTheme());
}

function applyTheme(theme) {
  elements.body.dataset.theme = theme;
  const moonIcon = elements.themeToggle.querySelector(".theme-icon-moon");
  const sunIcon = elements.themeToggle.querySelector(".theme-icon-sun");
  moonIcon?.classList.toggle("hidden", theme !== "light");
  sunIcon?.classList.toggle("hidden", theme === "light");
  elements.themeToggle.setAttribute("aria-label", theme === "light" ? "Enable dark mode" : "Enable light mode");
  elements.themeToggle.setAttribute("title", theme === "light" ? "Dark mode" : "Light mode");
}

async function handleThemeToggle() {
  await setTheme(elements.body.dataset.theme === "dark" ? "light" : "dark");
}

async function refreshCurrentTab() {
  state.currentTab = await getCurrentActiveTab();
  if (!state.activeTimer) {
    renderSelectedTabChip(state.currentTab);
  }
}

async function refreshExtensionState() {
  const response = await chrome.runtime.sendMessage({ type: "get-state" });
  state.activeTimer = response?.activeTimer ?? null;
  state.meetingJobs = response?.meetingJobs ?? [];
  state.activeMeetingSession = response?.activeMeetingSession ?? null;
  renderActiveTimer();
  renderMeetingQueue();
}

function setSetupUnit(unit, animate) {
  state.setupUnit = unit;
  elements.pickHours.classList.toggle("is-active", unit === "hours");
  elements.pickMinutes.classList.toggle("is-active", unit === "minutes");

  if (animate) {
    triggerRingSwitchAnimation();
  }

  if (!state.activeTimer) {
    renderIdleTimer();
  }
}

function triggerRingSwitchAnimation() {
  elements.ringInner.classList.add("is-switching");
  window.clearTimeout(state.switchAnimationHandle);
  state.switchAnimationHandle = window.setTimeout(() => {
    elements.ringInner.classList.remove("is-switching");
  }, 180);
}

function handleRingPointerDown(event) {
  if (state.activeTimer || event.button !== 0 || isModeSwitchTarget(event.target)) {
    return;
  }

  event.preventDefault();
  state.draggingRing = true;
  state.activePointerId = event.pointerId;
  elements.progressRing.classList.add("is-dragging");
  updateDurationFromPointer(event);
}

function handleRingPointerMove(event) {
  if (!state.draggingRing || state.activeTimer || event.pointerId !== state.activePointerId) {
    return;
  }

  event.preventDefault();
  updateDurationFromPointer(event);
}

function handleRingPointerUp(event) {
  if (!state.draggingRing || event.pointerId !== state.activePointerId) {
    return;
  }

  state.draggingRing = false;
  state.activePointerId = null;
  elements.progressRing.classList.remove("is-dragging");
}

function updateDurationFromPointer(event) {
  const rect = elements.progressRing.getBoundingClientRect();
  const centerX = rect.left + (rect.width / 2);
  const centerY = rect.top + (rect.height / 2);
  const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
  const normalized = (angle + (Math.PI / 2) + (Math.PI * 2)) % (Math.PI * 2);
  const ratio = normalized / (Math.PI * 2);

  if (state.setupUnit === "hours") {
    state.selectedHours = clampNumber(Math.round(ratio * MAX_HOURS), 0, MAX_HOURS);
  } else {
    state.selectedMinutes = clampNumber(Math.round(ratio * 60) % 60, 0, MAX_MINUTES);
  }

  renderIdleTimer();
}

async function handleStartTimer() {
  const targetTab = await getCurrentActiveTab();
  if (!targetTab) {
    elements.statusPill.textContent = "No tab";
    return;
  }

  const durationMs = getSelectedDurationMs();
  if (durationMs <= 5000) {
    elements.statusPill.textContent = "Too short";
    return;
  }

  elements.startTimer.disabled = true;
  const response = await chrome.runtime.sendMessage({
    type: "start-timer",
    payload: {
      tabId: targetTab.id,
      windowId: targetTab.windowId,
      title: targetTab.title,
      url: targetTab.url,
      favIconUrl: targetTab.favIconUrl,
      durationMs
    }
  });
  elements.startTimer.disabled = false;

  if (!response?.ok) {
    elements.statusPill.textContent = "Error";
    return;
  }

  state.currentTab = targetTab;
  await Promise.all([refreshExtensionState(), renderHistory()]);
}

async function handleCancelTimer() {
  await chrome.runtime.sendMessage({ type: "cancel-timer" });
  await Promise.all([refreshCurrentTab(), refreshExtensionState(), renderHistory()]);
}

async function handleAddFiveMinutes() {
  const response = await chrome.runtime.sendMessage({
    type: "extend-timer",
    payload: { additionalMs: FIVE_MINUTES_MS }
  });

  if (response?.ok) {
    await Promise.all([refreshExtensionState(), renderHistory()]);
  }
}

async function handleImportCalendar() {
  elements.importCalendar.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: "import-google-calendar-event" });
  elements.importCalendar.disabled = false;

  if (!response?.ok) {
    alert(response?.error ?? "Unable to import the current Google Calendar event.");
    return;
  }

  state.importedMeetingDraft = response.draft;
  elements.meetingUrl.value = response.draft.meetingUrl ?? "";
  elements.meetingJoinAt.value = formatDateTimeLocal(response.draft.joinAt);
  elements.meetingLeaveAt.value = formatDateTimeLocal(response.draft.leaveAt);
  renderMeetingPlatformBadge();
}

async function handleScheduleMeeting() {
  const meetingUrl = elements.meetingUrl.value.trim();
  const joinAt = parseDateTimeLocal(elements.meetingJoinAt.value);
  const leaveAt = parseDateTimeLocal(elements.meetingLeaveAt.value);
  const title = state.importedMeetingDraft?.title || "Scheduled meeting";

  if (!meetingUrl) {
    alert("Please enter a meeting link.");
    return;
  }
  if (!joinAt || !leaveAt || joinAt >= leaveAt) {
    alert("Please set valid join and leave times.");
    return;
  }

  elements.scheduleMeeting.disabled = true;
  const response = await chrome.runtime.sendMessage({
    type: "create-manual-meeting-job",
    payload: {
      source: state.importedMeetingDraft?.source || "manual",
      title,
      meetingUrl,
      joinAt,
      leaveAt,
      automation: {
        autoDisableMic: true,
        autoDisableCamera: true,
        autoJoin: true
      }
    }
  });
  elements.scheduleMeeting.disabled = false;

  if (!response?.ok) {
    alert(response?.error ?? "Unable to schedule the meeting.");
    return;
  }

  state.importedMeetingDraft = null;
  clearMeetingForm();
  await Promise.all([refreshExtensionState(), renderHistory()]);
}

async function handleCancelMeetingJob() {
  const job = getPrimaryMeetingJob();
  if (!job) {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "cancel-meeting-job",
    payload: { jobId: job.id }
  });

  if (response?.ok) {
    await Promise.all([refreshExtensionState(), renderHistory()]);
  }
}

function renderActiveTimer() {
  const timer = state.activeTimer;
  const hasActiveTimer = Boolean(timer);

  elements.timerEmpty.classList.toggle("hidden", hasActiveTimer);
  elements.timerLive.classList.toggle("hidden", !hasActiveTimer);
  elements.startTimer.classList.toggle("hidden", hasActiveTimer);
  elements.pickHours.disabled = hasActiveTimer;
  elements.pickMinutes.disabled = hasActiveTimer;
  elements.progressRing.setAttribute("aria-disabled", String(hasActiveTimer));

  if (!timer) {
    elements.statusPill.textContent = "Idle";
    elements.statusPill.classList.remove("is-active", "is-warning");
    elements.closeAt.textContent = "--:--";
    elements.liveUrl.textContent = "";
    renderSelectedTabChip(state.currentTab);
    renderIdleTimer();
    return;
  }

  elements.liveUrl.textContent = trimText(timer.url, 48);
  elements.statusPill.textContent = timer.status === TIMER_STATUS.warning ? "Warning" : "Running";
  elements.statusPill.classList.toggle("is-warning", timer.status === TIMER_STATUS.warning);
  elements.statusPill.classList.toggle("is-active", timer.status !== TIMER_STATUS.warning);
  elements.closeAt.textContent = new Date(timer.endTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  elements.ringLabel.textContent = timer.status === TIMER_STATUS.warning ? "Closing soon" : "Time left";
  renderSelectedTabChip({
    title: timer.title,
    url: timer.url,
    favIconUrl: timer.favIconUrl
  });
  updateCountdown();
}

function updateCountdown() {
  const timer = state.activeTimer;
  if (!timer) {
    return;
  }

  const now = Date.now();
  const remainingMs = Math.max(timer.endTime - now, 0);
  const elapsedMs = Math.max(now - timer.startTime, 0);
  const totalMs = Math.max(timer.endTime - timer.startTime, 1);
  const progress = Math.min((elapsedMs / totalMs) * 100, 100);

  elements.timeLeft.textContent = formatDuration(remainingMs);
  setRingVisual(Math.max(progress, 1) * 3.6);
}

function renderIdleTimer() {
  const angle = state.setupUnit === "hours"
    ? (state.selectedHours / MAX_HOURS) * 360
    : (state.selectedMinutes / 60) * 360;

  elements.ringLabel.textContent = state.setupUnit === "hours" ? "Pick hours" : "Pick minutes";
  elements.timeLeft.textContent = state.setupUnit === "hours"
    ? `${String(state.selectedHours).padStart(2, "0")}h`
    : `${String(state.selectedMinutes).padStart(2, "0")}m`;
  elements.statusPill.textContent = "Idle";
  elements.statusPill.classList.remove("is-active", "is-warning");
  elements.closeAt.textContent = `${String(state.selectedHours).padStart(2, "0")}h ${String(state.selectedMinutes).padStart(2, "0")}m`;
  elements.progressRing.setAttribute("aria-valuemin", "0");
  elements.progressRing.setAttribute("aria-valuemax", state.setupUnit === "hours" ? String(MAX_HOURS) : String(MAX_MINUTES));
  elements.progressRing.setAttribute("aria-valuenow", state.setupUnit === "hours" ? String(state.selectedHours) : String(state.selectedMinutes));
  elements.progressRing.setAttribute("aria-valuetext", state.setupUnit === "hours"
    ? `${state.selectedHours} hours selected`
    : `${state.selectedMinutes} minutes selected`);
  setRingVisual(angle);
}

function renderMeetingPlatformBadge() {
  const platform = detectMeetingPlatform(elements.meetingUrl.value.trim());
  if (platform === MEETING_PLATFORM.googleMeet) {
    elements.meetingPlatformBadge.textContent = "Google Meet";
    return;
  }
  if (platform === MEETING_PLATFORM.teams) {
    elements.meetingPlatformBadge.textContent = "Teams";
    return;
  }
  if (platform === MEETING_PLATFORM.zoom) {
    elements.meetingPlatformBadge.textContent = "Zoom";
    return;
  }
  elements.meetingPlatformBadge.textContent = "No link";
}

function renderMeetingSession() {
  const job = getPrimaryMeetingJob();
  const session = state.activeMeetingSession;

  if (!job) {
    elements.meetingSession.classList.add("hidden");
    return;
  }

  elements.meetingSession.classList.remove("hidden");
  elements.meetingSessionTitle.textContent = job.title;
  elements.meetingSessionUrl.textContent = trimText(job.meetingUrl, 60);
  elements.meetingSessionJoinAt.textContent = formatReadableDate(job.joinAt);
  elements.meetingSessionLeaveAt.textContent = formatReadableDate(job.leaveAt);
  elements.meetingSessionStatus.textContent = buildMeetingStatusText(job, session);
}

function getPrimaryMeetingJob() {
  const activeJobId = state.activeMeetingSession?.jobId;
  if (activeJobId) {
    return state.meetingJobs.find((job) => job.id === activeJobId) ?? null;
  }

  return state.meetingJobs.find((job) => (
    job.status !== MEETING_JOB_STATUS.cancelled &&
    job.status !== MEETING_JOB_STATUS.left
  )) ?? null;
}

function buildMeetingStatusText(job, session) {
  if (session?.jobId === job.id) {
    if (session.status === MEETING_JOB_STATUS.joined) {
      return "Meeting opened and join automation completed.";
    }
    if (session.status === MEETING_JOB_STATUS.failed) {
      return session.failureReason || "Meeting opened, but automation failed.";
    }
    return "Meeting tab opened. Waiting to join.";
  }

  if (job.status === MEETING_JOB_STATUS.scheduled) {
    return "Scheduled and waiting for the join time.";
  }
  if (job.status === MEETING_JOB_STATUS.failed) {
    return job.failureReason || "Meeting automation failed.";
  }
  if (job.status === MEETING_JOB_STATUS.cancelled) {
    return "Meeting schedule cancelled.";
  }
  if (job.status === MEETING_JOB_STATUS.left) {
    return "Meeting left at the scheduled time.";
  }
  return "Meeting schedule saved.";
}

function renderSelectedTabChip(tab) {
  if (!tab) {
    elements.selectedTabTitle.textContent = "No active tab";
    elements.selectedTabSubtitle.textContent = "Open a normal browser tab to use DipMeet";
    renderTabVisual(null);
    return;
  }

  elements.selectedTabTitle.textContent = trimText(tab.title, 34);
  elements.selectedTabSubtitle.textContent = trimText(tab.url || "Current tab", 42);
  renderTabVisual(tab);
}

function renderTabVisual(tab) {
  const favicon = tab?.favIconUrl;
  elements.selectedTabFavicon.classList.toggle("hidden", !favicon);
  elements.selectedTabFallback.classList.toggle("hidden", Boolean(favicon));

  if (favicon) {
    elements.selectedTabFavicon.src = favicon;
    elements.selectedTabFavicon.alt = `${tab.title || "Current"} favicon`;
    return;
  }

  elements.selectedTabFavicon.removeAttribute("src");
  elements.selectedTabFavicon.alt = "";
}

async function renderHistory() {
  const history = await getHistory();
  elements.historyList.innerHTML = "";

  if (!history.length) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = "<strong>No activity yet</strong><p>Your recent timers will show up here.</p>";
    elements.historyList.append(item);
    return;
  }

  for (const entry of history) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `
      <strong>${formatHistoryAction(entry.action)} - ${trimText(entry.title, 34)}</strong>
      <p>${new Date(entry.createdAt).toLocaleString()}</p>
    `;
    elements.historyList.append(item);
  }
}

function toggleHistory(isOpen) {
  elements.historySheet.classList.toggle("hidden", !isOpen);
  elements.historyToggle.classList.toggle("is-active", isOpen);
}

function startClock() {
  state.tickHandle = window.setInterval(() => {
    updateCountdown();
  }, 1000);
}

function getSelectedDurationMs() {
  return ((state.selectedHours * 60) + state.selectedMinutes) * 60000;
}

function setRingVisual(angle) {
  const safeAngle = Number.isFinite(angle) ? angle : 0;
  elements.progressRing.style.setProperty("--progress", `${safeAngle}deg`);
  elements.progressRing.style.setProperty("--knob-angle", `${safeAngle}deg`);
  elements.progressRingKnob?.style.setProperty("--knob-angle", `${safeAngle}deg`);
}

function isModeSwitchTarget(target) {
  return target instanceof Element && Boolean(target.closest("#ring-mode-switch"));
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function trimText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || "";
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.ceil(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTimeLocal(timestamp) {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocal(value) {
  if (!value) {
    return NaN;
  }
  return new Date(value).getTime();
}

function formatReadableDate(timestamp) {
  if (!timestamp) {
    return "--";
  }
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatHistoryAction(action) {
  switch (action) {
    case "started":
      return "Started";
    case "extended":
      return "Extended";
    case "meeting-scheduled":
      return "Meeting scheduled";
    case "cancelled":
      return "Cancelled";
    case "auto-closed":
      return "Auto-closed";
    case "manually-closed":
      return "Manually closed";
    case "already-closed":
      return "Already closed";
    case "missing-after-restart":
      return "Missing after restart";
    case "close-failed":
      return "Close failed";
    default:
      return "Updated";
  }
}

function clearMeetingForm() {
  elements.meetingUrl.value = "";
  elements.meetingJoinAt.value = "";
  elements.meetingLeaveAt.value = "";
  renderMeetingPlatformBadge();
}

function renderMeetingQueue() {
  const jobs = state.meetingJobs
    .filter((job) => job.status !== MEETING_JOB_STATUS.cancelled && job.status !== MEETING_JOB_STATUS.left)
    .sort((a, b) => a.joinAt - b.joinAt);

  if (jobs.length === 0) {
    elements.meetingQueue.classList.add("hidden");
    elements.meetingSession.classList.add("hidden");
    return;
  }

  const activeJobId = state.activeMeetingSession?.jobId;
  elements.meetingQueue.classList.remove("hidden");
  elements.meetingSession.classList.add("hidden");
  elements.queueList.innerHTML = "";

  jobs.forEach((job, index) => {
    const isActive = job.id === activeJobId;
    const item = document.createElement("div");
    item.className = `queue-item${isActive ? " is-active" : ""}`;
    item.dataset.jobId = job.id;

    const info = document.createElement("div");
    info.className = "queue-item-info";

    const title = document.createElement("p");
    title.className = "queue-item-title";
    const indexNum = index + 1;
    const statusBadge = isActive ? " (now)" : "";
    title.textContent = `${indexNum}. ${job.title}${statusBadge}`;

    const times = document.createElement("div");
    times.className = "queue-item-times";

    const joinDiv = document.createElement("div");
    joinDiv.className = "queue-item-time";
    joinDiv.innerHTML = `<span class="queue-item-time-label">Join</span><span class="queue-item-time-value">${formatReadableDate(job.joinAt)}</span>`;

    const leaveDiv = document.createElement("div");
    leaveDiv.className = "queue-item-time";
    leaveDiv.innerHTML = `<span class="queue-item-time-label">Leave</span><span class="queue-item-time-value">${formatReadableDate(job.leaveAt)}</span>`;

    times.appendChild(joinDiv);
    times.appendChild(leaveDiv);

    info.appendChild(title);
    info.appendChild(times);

    const removeBtn = document.createElement("button");
    removeBtn.className = "queue-item-remove";
    removeBtn.setAttribute("aria-label", `Remove ${job.title}`);
    removeBtn.setAttribute("title", "Remove meeting");
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
    removeBtn.addEventListener("click", () => handleRemoveQueueItem(job.id));

    item.appendChild(info);
    item.appendChild(removeBtn);
    elements.queueList.appendChild(item);
  });
}

async function handleRemoveQueueItem(jobId) {
  const response = await chrome.runtime.sendMessage({
    type: "cancel-meeting-job",
    payload: { jobId }
  });

  if (response?.ok) {
    await Promise.all([refreshExtensionState(), renderHistory()]);
  }
}

void initialize();
