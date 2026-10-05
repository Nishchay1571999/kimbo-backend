import { roundToTwoDecimals } from '../../../../common/math/round.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  localDate,
  localTime,
  reportingDate,
  shiftDate,
} from '../../../../common/time/calendar.js';
import { ENTRY_REPOSITORY } from '../../../entries/domain/entry.repository.js';
import type { EntryRepository } from '../../../entries/domain/entry.repository.js';
import type {
  Entry,
  ExerciseData,
} from '../../../entries/domain/entry.types.js';
import { HEALTH_PROFILE_REPOSITORY } from '../../domain/health-profile.repository.js';
import type {
  DayProfile,
  HealthProfileRepository,
} from '../../domain/health-profile.repository.js';
import type { Home, TimelineItem } from '../../domain/home.types.js';
export function buildHome(
  date: string,
  profile: DayProfile,
  entries: Entry[],
  now = new Date(),
): Home {
  const { timezone, wakeTime, sleepTime } = profile;
  const crossesMidnight = !!wakeTime && !!sleepTime && sleepTime < wakeTime;
  const endDate = crossesMidnight ? shiftDate(date, 1) : date;
  const start = wakeTime ? `${date}T${wakeTime}` : null;
  const end = sleepTime ? `${endDate}T${sleepTime}` : null;
  const timeline: TimelineItem[] = entries.map((entry) => {
    const instant = new Date(entry.occurredAt);
    const day = localDate(instant, timezone);
    const time = localTime(instant, timezone);
    const key = `${day}T${time}`;
    return {
      type: 'entry',
      date: day,
      time,
      outsideSchedule: !!((start && key < start) || (end && key > end)),
      entry,
    };
  });
  if (wakeTime)
    timeline.push({ type: 'boundary', boundary: 'wake', date, time: wakeTime });
  if (sleepTime)
    timeline.push({
      type: 'boundary',
      boundary: 'sleep',
      date: endDate,
      time: sleepTime,
    });
  timeline.sort(
    (a, b) =>
      `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`) ||
      (a.type === 'boundary' && a.boundary === 'wake'
        ? -1
        : b.type === 'boundary' && b.boundary === 'wake'
          ? 1
          : 0),
  );
  const nutritionEntries = entries.filter((e) => e.category === 'nutrition');
  const exercises = entries
    .filter((e) => e.category === 'exercise')
    .map((e) => e.data as ExerciseData);
  const isToday = date === localDate(now, timezone);
  const summary: Home['summary'] = {
    nutrition: {
      caloriesConsumedKcal: roundToTwoDecimals(
        nutritionEntries.reduce(
          (sum, e) => sum + (e.summary.caloriesKcal ?? 0),
          0,
        ),
      ),
      entryCount: nutritionEntries.length,
    },
    exercise: {
      durationMinutes: roundToTwoDecimals(
        exercises.reduce((sum, e) => sum + e.durationMinutes, 0),
      ),
      caloriesBurnedKcal:
        exercises.length === 0 ||
        exercises.some((e) => e.estimatedCaloriesBurnedKcal === null)
          ? null
          : roundToTwoDecimals(
              exercises.reduce(
                (sum, e) => sum + (e.estimatedCaloriesBurnedKcal ?? 0),
                0,
              ),
            ),
    },
  };
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(date));
  return {
    date,
    timezone,
    day: {
      label: isToday ? 'Today' : weekday,
      weekday,
      previous: shiftDate(date, -1),
      next: shiftDate(date, 1),
      isToday,
    },
    schedule: { wakeTime, sleepTime, crossesMidnight },
    summary,
    timeline,
    sections: [
      { type: 'nutrition_summary', data: summary.nutrition },
      { type: 'exercise_summary', data: summary.exercise },
      {
        type: 'timeline',
        data: { entries: timeline, startTime: wakeTime, endTime: sleepTime },
      },
    ],
  };
}
@Injectable()
export class GetHomeUseCase {
  constructor(
    @Inject(ENTRY_REPOSITORY) private readonly entries: EntryRepository,
    @Inject(HEALTH_PROFILE_REPOSITORY)
    private readonly profiles: HealthProfileRepository,
  ) {}
  async execute(userId: string, date?: string): Promise<Home> {
    const profile = await this.profiles.get(userId);
    const day =
      date === undefined
        ? localDate(new Date(), profile.timezone)
        : reportingDate(date);
    return buildHome(day, profile, await this.entries.list(userId, day));
  }
}
