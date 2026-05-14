import {
  MEETING_ALARM_PREFIXES,
  MEETING_JOB_STATUS,
  MEETING_PLATFORM,
  TIMER_ALARMS,
  TIMER_STATUS,
  WARNING_OFFSET_MS
} from "./lib/constants.js";
import {
  clearActiveMeetingSession,
  clearActiveTimer,
  getActiveMeetingSession,
  getActiveTimer,
  getMeetingJobs,
  pushHistoryEntry,
  setActiveMeetingSession,
  setActiveTimer,
  setMeetingJobs
} from "./lib/storage.js";
import { createMeetingAlarmName, detectMeetingPlatform, isSupportedMeetingUrl, parseMeetingAlarmName } from "./lib/meetings.js";
import { findBestMatchingTab } from "./lib/tabs.js";

chrome.runtime.onInstalled.addListener(() => {
  void restoreState();
});

chrome.runtime.onStartup.addListener(() => {
  void restoreState();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TIMER_ALARMS.warning) {
    void runWarningPhase();
    return;
  }

  if (alarm.name === TIMER_ALARMS.close) {
    void closeTargetTab();
    return;
  }

  const meetingAlarm = parseMeetingAlarmName(alarm.name);
  if (!meetingAlarm) {
    return;
  }

  if (meetingAlarm.type === "open") {
    void openScheduledMeeting(meetingAlarm.jobId);
    return;
  }

  if (meetingAlarm.type === "leave") {
    void leaveScheduledMeeting(meetingAlarm.jobId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleTabRemoved(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }
  void maybeAutomateMeetingTab(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  if (message.type === "start-timer") {
    void startTimer(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "cancel-timer") {
    void cancelTimer("cancelled")
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "extend-timer") {
    void extendTimer(Number(message.payload?.additionalMs ?? 0))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "create-manual-meeting-job") {
    void createManualMeetingJob(message.payload)
      .then((job) => sendResponse({ ok: true, job }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "cancel-meeting-job") {
    void cancelMeetingJob(message.payload?.jobId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "import-google-calendar-event") {
    void importGoogleCalendarEvent()
      .then((draft) => sendResponse({ ok: true, draft }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "get-state") {
    void Promise.all([getActiveTimer(), getMeetingJobs(), getActiveMeetingSession()]).then(([activeTimer, meetingJobs, activeMeetingSession]) => {
      sendResponse({ ok: true, activeTimer, meetingJobs, activeMeetingSession });
    });
    return true;
  }

  return false;
});

async function restoreState() {
  await Promise.all([restoreTimerState(), restoreMeetingJobs()]);
}

async function startTimer(payload) {
  const now = Date.now();
  const durationMs = Number(payload.durationMs);
  if (!payload || !Number.isFinite(durationMs) || durationMs <= WARNING_OFFSET_MS) {
    throw new Error("Choose a timer longer than 5 seconds.");
  }

  const timer = {
    tabId: payload.tabId,
    windowId: payload.windowId ?? null,
    title: payload.title ?? "Untitled tab",
    url: payload.url ?? "",
    favIconUrl: payload.favIconUrl ?? "",
    startTime: now,
    endTime: now + durationMs,
    warningTime: now + durationMs - WARNING_OFFSET_MS,
    status: TIMER_STATUS.scheduled
  };

  await clearExistingTimerAlarms();
  await setActiveTimer(timer);
  await pushHistoryEntry(buildHistoryEntry("started", timer));
  await scheduleTimer(timer);
}

async function cancelTimer(reason) {
  const timer = await getActiveTimer();
  if (!timer) {
    return;
  }

  await clearExistingTimerAlarms();
  await pushHistoryEntry(buildHistoryEntry(reason, timer));
  await clearActiveTimer();
}

async function extendTimer(additionalMs) {
  const timer = await getActiveTimer();
  if (!timer || !Number.isFinite(additionalMs) || additionalMs <= 0) {
    throw new Error("Unable to extend timer.");
  }

  timer.endTime += additionalMs;
  timer.warningTime = timer.endTime - WARNING_OFFSET_MS;
  timer.status = TIMER_STATUS.scheduled;

  await clearExistingTimerAlarms();
  await setActiveTimer(timer);
  await pushHistoryEntry(buildHistoryEntry("extended", timer));
  await scheduleTimer(timer);
}

async function restoreTimerState() {
  const timer = await getActiveTimer();
  if (!timer) {
    await clearExistingTimerAlarms();
    return;
  }

  const now = Date.now();
  if (timer.endTime <= now) {
    await closeTargetTab();
    return;
  }

  const matchedTab = await findBestMatchingTab(timer);
  if (!matchedTab) {
    await pushHistoryEntry(buildHistoryEntry("missing-after-restart", timer));
    await clearActiveTimer();
    await clearExistingTimerAlarms();
    return;
  }

  if (matchedTab.id !== timer.tabId) {
    timer.tabId = matchedTab.id;
    timer.windowId = matchedTab.windowId;
    await setActiveTimer(timer);
  }

  if (timer.warningTime <= now) {
    timer.status = TIMER_STATUS.warning;
    await setActiveTimer(timer);
  }

  await scheduleTimer(timer);
}

async function scheduleTimer(timer) {
  const now = Date.now();
  if (timer.warningTime > now) {
    await chrome.alarms.create(TIMER_ALARMS.warning, { when: timer.warningTime });
  }
  await chrome.alarms.create(TIMER_ALARMS.close, { when: timer.endTime });
}

async function runWarningPhase() {
  const timer = await getActiveTimer();
  if (!timer) {
    return;
  }

  timer.status = TIMER_STATUS.warning;
  await setActiveTimer(timer);

  await chrome.notifications.create({
    type: "basic",
    iconUrl: "src/assets/DipmeetLogoNoBG-128.png",
    title: "DipMeet",
    message: `Closing "${timer.title}" in 5 seconds.`,
    priority: 2
  }).catch(() => undefined);
}

async function closeTargetTab() {
  const timer = await getActiveTimer();
  if (!timer) {
    return;
  }

  const matchedTab = await findBestMatchingTab(timer);
  await clearExistingTimerAlarms();

  if (!matchedTab) {
    await pushHistoryEntry(buildHistoryEntry("already-closed", timer));
    await clearActiveTimer();
    return;
  }

  try {
    await chrome.tabs.remove(matchedTab.id);
    await pushHistoryEntry(buildHistoryEntry("auto-closed", { ...timer, tabId: matchedTab.id }));
  } catch {
    await pushHistoryEntry(buildHistoryEntry("close-failed", timer));
  }

  await clearActiveTimer();
}

async function createManualMeetingJob(payload) {
  const meetingUrl = String(payload?.meetingUrl ?? "").trim();
  const joinAt = Number(payload?.joinAt ?? 0);
  const leaveAt = Number(payload?.leaveAt ?? 0);
  const title = String(payload?.title ?? "").trim() || "Scheduled meeting";

  if (!meetingUrl || !isSupportedMeetingUrl(meetingUrl)) {
    throw new Error("Paste a supported Google Meet, Teams, or Zoom link.");
  }

  if (!Number.isFinite(joinAt) || !Number.isFinite(leaveAt) || joinAt <= Date.now() || leaveAt <= joinAt) {
    throw new Error("Choose a valid future join time and a leave time after it.");
  }

  const job = {
    id: crypto.randomUUID(),
    source: payload?.source ?? "manual",
    title,
    meetingUrl,
    platform: detectMeetingPlatform(meetingUrl),
    joinAt,
    leaveAt,
    status: MEETING_JOB_STATUS.scheduled,
    createdAt: Date.now(),
    automation: {
      autoDisableMic: payload?.automation?.autoDisableMic ?? true,
      autoDisableCamera: payload?.automation?.autoDisableCamera ?? true,
      autoJoin: payload?.automation?.autoJoin ?? true
    }
  };

  const jobs = await getMeetingJobs();
  jobs.unshift(job);
  await setMeetingJobs(jobs);
  await scheduleMeetingJob(job);
  await pushHistoryEntry({
    id: crypto.randomUUID(),
    action: "meeting-scheduled",
    title: job.title,
    url: job.meetingUrl,
    createdAt: Date.now()
  });
  return job;
}

async function cancelMeetingJob(jobId) {
  if (!jobId) {
    throw new Error("Missing meeting job id.");
  }

  const jobs = await getMeetingJobs();
  const job = jobs.find((entry) => entry.id === jobId);
  if (!job) {
    throw new Error("Meeting job not found.");
  }

  await chrome.alarms.clear(createMeetingAlarmName(MEETING_ALARM_PREFIXES.open, jobId));
  await chrome.alarms.clear(createMeetingAlarmName(MEETING_ALARM_PREFIXES.leave, jobId));

  const nextJobs = jobs.map((entry) => entry.id === jobId ? { ...entry, status: MEETING_JOB_STATUS.cancelled, cancelledAt: Date.now() } : entry);
  await setMeetingJobs(nextJobs);

  const activeSession = await getActiveMeetingSession();
  if (activeSession?.jobId === jobId) {
    await clearActiveMeetingSession();
  }
}

async function importGoogleCalendarEvent() {
  const [currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!currentTab?.id || !currentTab.url?.includes("calendar.google.com")) {
    throw new Error("Open Google Calendar and select or view the event you want to import.");
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: currentTab.id },
    func: () => {
      const supportedLink = document.querySelector('a[href*="meet.google.com"], a[href*="teams.microsoft.com"], a[href*="zoom.us"]');
      if (!supportedLink) {
        throw new Error("No supported meeting link found on the current Google Calendar view.");
      }

      const root = supportedLink.closest('[role="dialog"], [role="main"], body');
      const title = root?.querySelector('[role="heading"]')?.textContent?.trim() || supportedLink.textContent?.trim() || "Calendar meeting";
      const rawText = root?.textContent || "";
      
      let joinAt = null;
      let leaveAt = null;

      // Try multiple time format patterns
      // Pattern 1: "HH:MM[am/pm] – HH:MM[am/pm]" (each time has optional meridiem)
      let match = rawText.match(/(\d{1,2}):(\d{2})\s*(am|pm)?\s*[–-]\s*(\d{1,2}):(\d{2})\s*(am|pm)/i);
      
      if (match) {
        const startHours = Number(match[1]);
        const startMinutes = Number(match[2]);
        const startMeridiem = match[3] ? match[3].toUpperCase() : null;
        const endHours = Number(match[4]);
        const endMinutes = Number(match[5]);
        const endMeridiem = match[6].toUpperCase();

        const now = new Date();
        
        // If start time doesn't have meridiem, infer it from end meridiem or assume same day
        const inferredStartMeridiem = startMeridiem || endMeridiem;
        
        const startDate = convertTo24Hour(startHours, startMinutes, inferredStartMeridiem, now);
        const endDate = convertTo24Hour(endHours, endMinutes, endMeridiem, now);
        
        // If end time is before start time, assume it's the next day
        if (endDate <= startDate) {
          endDate.setDate(endDate.getDate() + 1);
        }

        joinAt = startDate.getTime();
        leaveAt = endDate.getTime();
      }

      return {
        source: "google-calendar",
        title,
        meetingUrl: supportedLink.href,
        joinAt,
        leaveAt
      };

      function convertTo24Hour(hours, minutes, meridiem, baseDate) {
        let h = hours;
        
        if (meridiem) {
          if (meridiem === "PM" && h !== 12) {
            h += 12;
          } else if (meridiem === "AM" && h === 12) {
            h = 0;
          }
        }
        
        const date = new Date(baseDate);
        date.setHours(h, minutes, 0, 0);
        return date;
      }
    }
  });

  if (!result?.meetingUrl || !isSupportedMeetingUrl(result.meetingUrl)) {
    throw new Error("The current Google Calendar event does not include a supported meeting link.");
  }

  return {
    ...result,
    platform: detectMeetingPlatform(result.meetingUrl)
  };
}

async function restoreMeetingJobs() {
  const jobs = await getMeetingJobs();
  const now = Date.now();

  for (const job of jobs) {
    if (job.status === MEETING_JOB_STATUS.cancelled || job.status === MEETING_JOB_STATUS.left || job.status === MEETING_JOB_STATUS.failed) {
      continue;
    }

    if (job.leaveAt <= now) {
      continue;
    }

    await scheduleMeetingJob(job);
  }

  const session = await getActiveMeetingSession();
  if (session?.leaveAt > now) {
    await chrome.alarms.create(createMeetingAlarmName(MEETING_ALARM_PREFIXES.leave, session.jobId), { when: session.leaveAt });
  }
}

async function scheduleMeetingJob(job) {
  await chrome.alarms.create(createMeetingAlarmName(MEETING_ALARM_PREFIXES.open, job.id), { when: job.joinAt });
  await chrome.alarms.create(createMeetingAlarmName(MEETING_ALARM_PREFIXES.leave, job.id), { when: job.leaveAt });
}

async function openScheduledMeeting(jobId) {
  const jobs = await getMeetingJobs();
  const job = jobs.find((entry) => entry.id === jobId);
  if (!job) {
    return;
  }

  const createdTab = await chrome.tabs.create({
    url: job.meetingUrl,
    active: true
  });

  const session = {
    jobId: job.id,
    tabId: createdTab.id,
    title: job.title,
    meetingUrl: job.meetingUrl,
    platform: job.platform,
    leaveAt: job.leaveAt,
    openedAt: Date.now(),
    joinedAt: null,
    status: MEETING_JOB_STATUS.opening,
    automation: job.automation
  };

  await setActiveMeetingSession(session);
  await setMeetingJobs(jobs.map((entry) => entry.id === jobId ? { ...entry, status: MEETING_JOB_STATUS.opening, openedAt: Date.now(), tabId: createdTab.id } : entry));
}

async function maybeAutomateMeetingTab(tabId) {
  const session = await getActiveMeetingSession();
  if (!session || session.tabId !== tabId || session.status !== MEETING_JOB_STATUS.opening) {
    return;
  }

  const result = await runMeetingAutomation(tabId, session.platform, session.automation);
  const jobs = await getMeetingJobs();

  if (!result.ok) {
    await setActiveMeetingSession({
      ...session,
      status: MEETING_JOB_STATUS.failed,
      failureReason: result.error || "Automation failed"
    });
    await setMeetingJobs(jobs.map((entry) => entry.id === session.jobId ? {
      ...entry,
      status: MEETING_JOB_STATUS.failed,
      failureReason: result.error || "Automation failed"
    } : entry));
    return;
  }

  await setActiveMeetingSession({
    ...session,
    status: MEETING_JOB_STATUS.joined,
    joinedAt: Date.now()
  });
  await setMeetingJobs(jobs.map((entry) => entry.id === session.jobId ? {
    ...entry,
    status: MEETING_JOB_STATUS.joined,
    joinedAt: Date.now()
  } : entry));
}

async function leaveScheduledMeeting(jobId) {
  const session = await getActiveMeetingSession();
  const jobs = await getMeetingJobs();
  const job = jobs.find((entry) => entry.id === jobId);
  if (!job) {
    return;
  }

  if (session?.jobId === jobId && typeof session.tabId === "number") {
    await runLeaveAutomation(session.tabId, session.platform).catch(() => undefined);
    await chrome.tabs.remove(session.tabId).catch(() => undefined);
    await clearActiveMeetingSession();
  }

  await setMeetingJobs(jobs.map((entry) => entry.id === jobId ? {
    ...entry,
    status: MEETING_JOB_STATUS.left,
    leftAt: Date.now()
  } : entry));
}

async function handleTabRemoved(tabId) {
  const timer = await getActiveTimer();
  if (timer?.tabId === tabId) {
    await clearExistingTimerAlarms();
    await pushHistoryEntry(buildHistoryEntry("manually-closed", timer));
    await clearActiveTimer();
  }

  const session = await getActiveMeetingSession();
  if (!session || session.tabId !== tabId) {
    return;
  }

  const jobs = await getMeetingJobs();
  await setMeetingJobs(jobs.map((entry) => entry.id === session.jobId ? {
    ...entry,
    status: MEETING_JOB_STATUS.left,
    leftAt: Date.now()
  } : entry));
  await clearActiveMeetingSession();
}

async function clearExistingTimerAlarms() {
  await chrome.alarms.clear(TIMER_ALARMS.warning);
  await chrome.alarms.clear(TIMER_ALARMS.close);
}

function buildHistoryEntry(action, timer) {
  return {
    id: crypto.randomUUID(),
    action,
    title: timer.title,
    url: timer.url,
    tabId: timer.tabId,
    endTime: timer.endTime,
    createdAt: Date.now()
  };
}

async function runMeetingAutomation(tabId, platform, automation) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [platform, automation],
      func: async (targetPlatform, targetAutomation) => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const clickFirst = (selectors) => {
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element instanceof HTMLElement) {
              element.click();
              return true;
            }
          }
          return false;
        };

        const findByText = (texts) => {
          const candidates = [...document.querySelectorAll("button, div[role='button'], span[role='button']")];
          return candidates.find((element) => {
            const label = (element.getAttribute("aria-label") || element.textContent || "").trim().toLowerCase();
            return texts.some((text) => label.includes(text));
          });
        };

        const toggleByText = (texts) => {
          const element = findByText(texts);
          if (element instanceof HTMLElement) {
            element.click();
            return true;
          }
          return false;
        };

        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (targetPlatform === "google-meet") {
            if (targetAutomation.autoDisableCamera) {
              clickFirst([
                'button[aria-label*="Turn off camera"]',
                'button[aria-label*="camera off"]'
              ]) || toggleByText(["turn off camera", "camera off"]);
            }

            if (targetAutomation.autoDisableMic) {
              clickFirst([
                'button[aria-label*="Turn off microphone"]',
                'button[aria-label*="microphone off"]'
              ]) || toggleByText(["turn off microphone", "microphone off", "mute microphone"]);
            }

            if (!targetAutomation.autoJoin) {
              return { ok: true, joined: false };
            }

            const joined = clickFirst([
              'button[aria-label*="Join now"]',
              'button[aria-label*="Ask to join"]'
            ]) || Boolean(toggleByText(["join now", "ask to join"]));

            if (joined) {
              return { ok: true, joined: true };
            }
          }

          if (targetPlatform === "teams") {
            if (targetAutomation.autoDisableCamera) {
              toggleByText(["camera"]);
            }

            if (targetAutomation.autoDisableMic) {
              toggleByText(["mic", "microphone"]);
            }

            if (!targetAutomation.autoJoin) {
              return { ok: true, joined: false };
            }

            const joined = Boolean(toggleByText(["join now", "join meeting", "continue without audio"]));
            if (joined) {
              return { ok: true, joined: true };
            }
          }

          if (targetPlatform === "zoom") {
            if (targetAutomation.autoDisableCamera) {
              toggleByText(["stop video", "video off", "turn off video"]);
            }

            if (targetAutomation.autoDisableMic) {
              toggleByText(["mute", "mute my audio", "join without computer audio"]);
            }

            if (!targetAutomation.autoJoin) {
              return { ok: true, joined: false };
            }

            const joined = Boolean(toggleByText(["join", "launch meeting", "join audio by computer"]));
            if (joined) {
              return { ok: true, joined: true };
            }
          }

          await wait(750);
        }

        return {
          ok: false,
          error: `Could not automate ${targetPlatform} on the current page.`
        };
      }
    });

    return result ?? { ok: false, error: "Automation returned no result." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Automation injection failed." };
  }
}

async function runLeaveAutomation(tabId, platform) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [platform],
    func: async (targetPlatform) => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const findByText = (texts) => {
        const candidates = [...document.querySelectorAll("button, div[role='button'], span[role='button']")];
        return candidates.find((element) => {
          const label = (element.getAttribute("aria-label") || element.textContent || "").trim().toLowerCase();
          return texts.some((text) => label.includes(text));
        });
      };

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const leaveButton = targetPlatform === "google-meet"
          ? findByText(["leave call", "end call"])
          : findByText(["leave", "hang up", "end"]);

        if (leaveButton instanceof HTMLElement) {
          leaveButton.click();
          return true;
        }

        await wait(500);
      }

      return false;
    }
  }).catch(() => undefined);
}
