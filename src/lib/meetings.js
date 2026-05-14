import { MEETING_ALARM_PREFIXES, MEETING_PLATFORM } from "./constants.js";

export function detectMeetingPlatform(url) {
  const normalized = String(url || "").toLowerCase();
  if (normalized.includes("meet.google.com")) {
    return MEETING_PLATFORM.googleMeet;
  }
  if (normalized.includes("teams.microsoft.com")) {
    return MEETING_PLATFORM.teams;
  }
  if (normalized.includes("zoom.us")) {
    return MEETING_PLATFORM.zoom;
  }
  return MEETING_PLATFORM.unknown;
}

export function createMeetingAlarmName(prefix, jobId) {
  return `${prefix}${jobId}`;
}

export function parseMeetingAlarmName(name) {
  if (name.startsWith(MEETING_ALARM_PREFIXES.open)) {
    return {
      type: "open",
      jobId: name.slice(MEETING_ALARM_PREFIXES.open.length)
    };
  }

  if (name.startsWith(MEETING_ALARM_PREFIXES.leave)) {
    return {
      type: "leave",
      jobId: name.slice(MEETING_ALARM_PREFIXES.leave.length)
    };
  }

  return null;
}

export function isSupportedMeetingUrl(url) {
  return detectMeetingPlatform(url) !== MEETING_PLATFORM.unknown;
}
