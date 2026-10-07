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
import type {
  Home,
  TimelineItem,
  Week,
} from '../../domain/home.types.js';
import { buildDayGoal, dayStatus } from '../../domain/day-goal.js';
import { GOAL_TARGET_REPOSITORY } from '../../../goals/domain/goal-target.js';
import type {
  GoalTarget,
  GoalTargetRepository,
} from '../../../goals/domain/goal-target.js';
export interface GoalContext {
  target: Pick<GoalTarget, 'caloriesKcal' | 'proteinG'>;
  recentEntries: Entry[];
}
export function buildHome(
  date: string,
  profile: DayProfile,
  entries: Entry[],
  now = new Date(),
  goalContext: GoalContext | null = null,
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
    goal: goalContext
      ? buildDayGoal({
          target: goalContext.target,
          entries,
          isToday,
          localTime: localTime(now, timezone),
          recentEntries: goalContext.recentEntries,
        })
      : null,
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
    @Inject(GOAL_TARGET_REPOSITORY)
    private readonly targets: GoalTargetRepository,
  ) {}
  async execute(userId: string, date?: string): Promise<Home> {
    const [profile, target] = await Promise.all([
      this.profiles.get(userId),
      this.targets.get(userId),
    ]);
    const day =
      date === undefined
        ? localDate(new Date(), profile.timezone)
        : reportingDate(date);
    const [entries, recentEntries] = await Promise.all([
      this.entries.list(userId, day),
      target
        ? this.entries.listRange(userId, shiftDate(day, -7), shiftDate(day, -1))
        : Promise.resolve([]),
    ]);
    return buildHome(
      day,
      profile,
      entries,
      new Date(),
      target ? { target, recentEntries } : null,
    );
  }
  /** Monday–Sunday statuses for the week containing `date`. */
  async week(userId: string, date?: string): Promise<Week> {
    const [profile, target] = await Promise.all([
      this.profiles.get(userId),
      this.targets.get(userId),
    ]);
    const today = localDate(new Date(), profile.timezone);
    date = date === undefined ? today : reportingDate(date);
    const from = shiftDate(date, -((new Date(date).getUTCDay() + 6) % 7));
    const to = shiftDate(from, 6);
    const entries = await this.entries.listRange(userId, from, to);
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = shiftDate(from, index);
      const meals = entries.filter(
        (e) => e.entryDate === day && e.category === 'nutrition',
      );
      const caloriesKcal = Math.round(
        meals.reduce((sum, e) => sum + (e.summary.caloriesKcal ?? 0), 0),
      );
      const logged = entries.some((e) => e.entryDate === day);
      if (day > today)
        return { date: day, status: 'future' as const, caloriesKcal, deltaKcal: null };
      if (!target)
        return {
          date: day,
          status: logged ? ('logged' as const) : ('not_logged' as const),
          caloriesKcal,
          deltaKcal: null,
        };
      return {
        date: day,
        status: dayStatus(caloriesKcal, target.caloriesKcal, meals.length > 0, day === today),
        caloriesKcal,
        deltaKcal: meals.length ? caloriesKcal - target.caloriesKcal : null,
      };
    });
    return { from, to, hasTarget: !!target, days };
  }
}
