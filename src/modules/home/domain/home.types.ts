import type { Entry } from '../../entries/domain/entry.types.js';
import type { DayGoal, DayStatus } from './day-goal.js';
export type TimelineItem =
  | { type: 'boundary'; boundary: 'wake' | 'sleep'; date: string; time: string }
  | {
      type: 'entry';
      date: string;
      time: string;
      outsideSchedule: boolean;
      entry: Entry;
    };
export interface Home {
  date: string;
  timezone: string;
  day: {
    label: string;
    weekday: string;
    previous: string;
    next: string;
    isToday: boolean;
  };
  schedule: {
    wakeTime: string | null;
    sleepTime: string | null;
    crossesMidnight: boolean;
  };
  summary: {
    nutrition: { caloriesConsumedKcal: number; entryCount: number };
    exercise: { durationMinutes: number; caloriesBurnedKcal: number | null };
  };
  /** Null without a confirmed target: no allowance is ever invented. */
  goal: DayGoal | null;
  timeline: TimelineItem[];
  sections: (
    | { type: 'nutrition_summary'; data: Home['summary']['nutrition'] }
    | { type: 'exercise_summary'; data: Home['summary']['exercise'] }
    | {
        type: 'timeline';
        data: {
          entries: TimelineItem[];
          startTime: string | null;
          endTime: string | null;
        };
      }
  )[];
}
export interface WeekDay {
  date: string;
  /** 'logged' is used when there is no confirmed target to compare against. */
  status: DayStatus | 'logged' | 'future';
  caloriesKcal: number;
  deltaKcal: number | null;
}
export interface Week {
  from: string;
  to: string;
  hasTarget: boolean;
  days: WeekDay[];
}
