export const STORAGE_KEYS = {
  theme: "theme",
  activeTimer: "activeTimer",
  history: "history",
  meetingJobs: "meetingJobs",
  activeMeetingSession: "activeMeetingSession"
};

export const TIMER_ALARMS = {
  warning: "dipmeet-warning",
  close: "dipmeet-close"
};

export const MEETING_ALARM_PREFIXES = {
  open: "dipmeet-meeting-open:",
  leave: "dipmeet-meeting-leave:"
};

export const TIMER_STATUS = {
  scheduled: "scheduled",
  warning: "warning"
};

export const MEETING_JOB_STATUS = {
  scheduled: "scheduled",
  opening: "opening",
  joined: "joined",
  left: "left",
  failed: "failed",
  cancelled: "cancelled"
};

export const MEETING_SOURCE = {
  manual: "manual",
  googleCalendar: "google-calendar"
};

export const MEETING_PLATFORM = {
  googleMeet: "google-meet",
  teams: "teams",
  zoom: "zoom",
  unknown: "unknown"
};

export const HISTORY_LIMIT = 20;

export const WARNING_OFFSET_MS = 5000;
