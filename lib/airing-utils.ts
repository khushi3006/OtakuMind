const DAY_MAP: Record<string, number> = {
  sunday: 0, sundays: 0, sun: 0,
  monday: 1, mondays: 1, mon: 1,
  tuesday: 2, tuesdays: 2, tue: 2,
  wednesday: 3, wednesdays: 3, wed: 3,
  thursday: 4, thursdays: 4, thu: 4,
  friday: 5, fridays: 5, fri: 5,
  saturday: 6, saturdays: 6, sat: 6,
};

export type CountdownResult = {
  diffMs: number;
  days: number;
  hours: number;
  minutes: number;
  label: string;
  isToday: boolean;
  isAiringNow: boolean;
};

/**
 * Helper to adjust a Date to IST (UTC+5:30) represented as a UTC date.
 * Calling getUTC* methods on the returned Date yields correct IST values.
 */
export function getISTDate(date: Date = new Date()): Date {
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
}

/**
 * Converts a weekly broadcast day and time in JST (UTC+9) to IST (UTC+5:30).
 */
export function getISTBroadcastDetails(
  broadcastDay: string | null,
  broadcastTime: string | null
): { day: string; time: string } | null {
  if (!broadcastDay || !broadcastTime) return null;

  const normalizedDay = broadcastDay.toLowerCase().replace(/s$/, ''); // "Saturdays" -> "saturday"
  const dayIndex = DAY_MAP[normalizedDay];
  if (dayIndex === undefined) return null;

  const timeMatch = broadcastTime.match(/^(\d{2}):(\d{2})$/);
  if (!timeMatch) return null;

  const jstHour = parseInt(timeMatch[1], 10);
  const jstMinute = parseInt(timeMatch[2], 10);

  let istMinute = jstMinute - 30;
  let istHour = jstHour - 3;
  let istDayIndex = dayIndex;

  if (istMinute < 0) {
    istMinute += 60;
    istHour -= 1;
  }
  if (istHour < 0) {
    istHour += 24;
    istDayIndex = (istDayIndex - 1 + 7) % 7;
  }

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const formattedTime = `${String(istHour).padStart(2, '0')}:${String(istMinute).padStart(2, '0')}`;
  
  return {
    day: days[istDayIndex],
    time: formattedTime
  };
}

/**
 * Calculates the next airing time in UTC and the countdown details.
 * Performs checks using Indian Standard Time (IST).
 */
export function calculateAiringCountdown(
  broadcastDay: string | null,
  broadcastTime: string | null,
  _broadcastTimezone: string | null = 'Asia/Tokyo'
): CountdownResult | null {
  if (!broadcastDay || !broadcastTime) return null;

  const normalizedDay = broadcastDay.toLowerCase().replace(/s$/, ''); // "Saturdays" -> "saturday"
  const dayIndex = DAY_MAP[normalizedDay];
  if (dayIndex === undefined) return null;

  const timeMatch = broadcastTime.match(/^(\d{2}):(\d{2})$/);
  if (!timeMatch) return null;

  const jstHour = parseInt(timeMatch[1], 10);
  const utcMinute = parseInt(timeMatch[2], 10);

  // Japan Standard Time (JST) is UTC+9. No daylight savings.
  let utcDay = dayIndex;
  let utcHour = jstHour - 9;
  if (utcHour < 0) {
    utcHour += 24;
    utcDay = (utcDay - 1 + 7) % 7;
  }

  const now = new Date();
  const currentUTCDay = now.getUTCDay();

  let daysDiff = utcDay - currentUTCDay;
  if (daysDiff < 0) {
    daysDiff += 7;
  }

  const nextBroadcast = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysDiff,
    utcHour,
    utcMinute,
    0, 0
  ));

  let diffMs = nextBroadcast.getTime() - now.getTime();

  // If it aired within the last 2 hours, it's "airing now / just aired"
  // If it was more than 2 hours ago, the next episode will be next week
  if (diffMs < -2 * 60 * 60 * 1000) {
    nextBroadcast.setUTCDate(nextBroadcast.getUTCDate() + 7);
    diffMs = nextBroadcast.getTime() - now.getTime();
  }

  const isAiringNow = diffMs <= 0 && diffMs >= -2 * 60 * 60 * 1000;

  const days = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  const hours = Math.max(0, Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)));
  const minutes = Math.max(0, Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000)));

  // Determine if it airs today in IST
  const istBroadcast = getISTDate(nextBroadcast);
  const istNow = getISTDate(now);
  const isToday = istBroadcast.getUTCDay() === istNow.getUTCDay() && !isAiringNow;

  let label = '';
  if (isAiringNow) {
    label = 'Airing Now';
  } else if (days === 0 && hours === 0 && minutes === 0) {
    label = 'Airing Now';
  } else if (days === 0 && hours === 0) {
    label = `in ${minutes}m`;
  } else if (days === 0) {
    label = `in ${hours}h ${minutes}m`;
  } else {
    label = `in ${days}d ${hours}h`;
  }

  return {
    diffMs,
    days,
    hours,
    minutes,
    label,
    isToday,
    isAiringNow,
  };
}

/**
 * Builds a CountdownResult from an exact air time (Unix seconds, UTC) — used when
 * AniList supplies a precise `airingAt`, which is more accurate than the
 * broadcast-day heuristic. Returns null if the timestamp is missing or aired more
 * than 2 hours ago (stale — caller should fall back / refetch).
 */
export function countdownFromAiringAt(
  airingAt: number | null | undefined
): CountdownResult | null {
  if (!airingAt) return null;

  const target = new Date(airingAt * 1000);
  if (isNaN(target.getTime())) return null;

  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  // More than 2h past the scheduled time means our data is stale.
  if (diffMs < -2 * 60 * 60 * 1000) return null;

  const isAiringNow = diffMs <= 0 && diffMs >= -2 * 60 * 60 * 1000;

  const days = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  const hours = Math.max(0, Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)));
  const minutes = Math.max(0, Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000)));

  const istTarget = getISTDate(target);
  const istNow = getISTDate(now);
  const isToday = istTarget.getUTCDay() === istNow.getUTCDay() && !isAiringNow;

  let label = '';
  if (isAiringNow || (days === 0 && hours === 0 && minutes === 0)) {
    label = 'Airing Now';
  } else if (days === 0 && hours === 0) {
    label = `in ${minutes}m`;
  } else if (days === 0) {
    label = `in ${hours}h ${minutes}m`;
  } else {
    label = `in ${days}d ${hours}h`;
  }

  return { diffMs, days, hours, minutes, label, isToday, isAiringNow };
}

/**
 * Gets the broadcast day name in IST (e.g. "Monday") for the weekly schedule
 */
export function getLocalBroadcastDay(
  broadcastDay: string | null,
  broadcastTime: string | null
): string {
  const istDetails = getISTBroadcastDetails(broadcastDay, broadcastTime);
  return istDetails ? istDetails.day : 'Unknown';
}
