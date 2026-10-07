import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { reportingDate, shiftDate } from '../../../common/time/calendar.js';
import { roundToTwoDecimals } from '../../../common/math/round.js';
import { ENTRY_REPOSITORY } from '../../entries/domain/entry.repository.js';
import type { EntryRepository } from '../../entries/domain/entry.repository.js';
import type { Entry } from '../../entries/domain/entry.types.js';
import { HEALTH_PROFILE_REPOSITORY } from '../../home/domain/health-profile.repository.js';
import type { HealthProfileRepository } from '../../home/domain/health-profile.repository.js';
import {
  buildHome,
  GetHomeUseCase,
} from '../../home/application/get-home/get-home.use-case.js';
import { dayStatus, exerciseBurn } from '../../home/domain/day-goal.js';
import { GOAL_TARGET_REPOSITORY } from '../../goals/domain/goal-target.js';
import type { GoalTargetRepository } from '../../goals/domain/goal-target.js';

export function healthPeriod(from: string, to: string) {
  reportingDate(from);
  reportingDate(to);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days < 1 || days > 93)
    throw new BadRequestException('Health ranges must contain 1–93 days');
  return { from, to, days };
}
export function weekPeriod(anchor: string) {
  reportingDate(anchor);
  const from = shiftDate(anchor, -((new Date(anchor).getUTCDay() + 6) % 7));
  return { from, to: shiftDate(from, 6) };
}
export function monthPeriod(anchor: string) {
  reportingDate(anchor);
  const from = `${anchor.slice(0, 7)}-01`;
  const next = new Date(from);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: shiftDate(next.toISOString().slice(0, 10), -1) };
}
// Attachments and unconfirmed AI proposals never enter retrieval prompts.
export function healthEntry(entry: Entry) {
  const {
    id,
    revision,
    category,
    title,
    note,
    entryDate,
    occurredAt,
    data,
    summary,
  } = entry;
  return {
    id,
    revision,
    category,
    title,
    note: note?.slice(0, 1000) ?? null,
    entryDate,
    occurredAt,
    data,
    summary,
  };
}
export function entityProvenance(entries: Entry[]) {
  return {
    entities: entries.map((entry) => ({
      entityId: entry.id,
      revision: entry.revision,
    })),
    healthRecordIds: [] as string[],
  };
}
@Injectable()
export class HealthProjectionService {
  constructor(
    @Inject(ENTRY_REPOSITORY) private readonly entries: EntryRepository,
    @Inject(HEALTH_PROFILE_REPOSITORY)
    private readonly profiles: HealthProfileRepository,
    @Inject(GetHomeUseCase) private readonly home: GetHomeUseCase,
    @Inject(GOAL_TARGET_REPOSITORY)
    private readonly targets: GoalTargetRepository,
  ) {}
  async day(userId: string, date: string) {
    const home = await this.home.execute(userId, date);
    const entries = home.timeline.flatMap((item) =>
      item.type === 'entry' ? [item.entry] : [],
    );
    const snapshot = {
      date: home.date,
      timezone: home.timezone,
      schedule: home.schedule,
      summary: home.summary,
      // Server-computed comparison with the user's confirmed target (null if none).
      goal: home.goal,
      entries: entries.map(healthEntry),
    };
    return {
      modelData: {
        ...snapshot,
        entries: snapshot.entries.slice(-8),
        entriesTruncated: entries.length > 8,
      },
      snapshot,
      provenance: entityProvenance(entries),
    };
  }
  async range(userId: string, from: string, to: string) {
    const period = healthPeriod(from, to);
    const [profile, entries, target] = await Promise.all([
      this.profiles.get(userId),
      this.entries.listRange(userId, from, to),
      this.targets.get(userId),
    ]);
    const groups = new Map<string, Entry[]>();
    for (const entry of entries)
      groups.set(entry.entryDate, [
        ...(groups.get(entry.entryDate) ?? []),
        entry,
      ]);
    const days = Array.from({ length: period.days }, (_, index) => {
      const date = shiftDate(from, index);
      const items = groups.get(date) ?? [];
      const home = buildHome(date, profile, items);
      const consumed = home.summary.nutrition.caloriesConsumedKcal;
      const burn = exerciseBurn(items);
      const netKcal = roundToTwoDecimals(consumed - burn.caloriesKcal);
      const logged = home.summary.nutrition.entryCount > 0;
      return {
        date,
        tracked: items.length > 0,
        ...home.summary,
        // consumed − burned; exercise without an estimate counts as 0.
        netKcal,
        // Server-computed comparison of net calories with the confirmed target; null when unknown.
        goal: target
          ? {
              status: dayStatus(
                netKcal,
                target.caloriesKcal,
                logged,
                home.day.isToday,
              ),
              deltaKcal: logged
                ? Math.round(netKcal - target.caloriesKcal)
                : null,
            }
          : null,
      };
    });
    const nutritionDays = days.filter((day) => day.nutrition.entryCount > 0);
    const exerciseDays = days.filter((day) => day.exercise.durationMinutes > 0);
    const caloriesConsumedKcal = roundToTwoDecimals(
      days.reduce((sum, day) => sum + day.nutrition.caloriesConsumedKcal, 0),
    );
    const snapshot = {
      from,
      to,
      timezone: profile.timezone,
      target: target
        ? { caloriesKcal: target.caloriesKcal, proteinG: target.proteinG }
        : null,
      summary: {
        daysInRange: period.days,
        daysTracked: days.filter((day) => day.tracked).length,
        daysWithNutrition: nutritionDays.length,
        caloriesConsumedKcal,
        averageCaloriesConsumedKcal: nutritionDays.length
          ? roundToTwoDecimals(caloriesConsumedKcal / nutritionDays.length)
          : null,
        exerciseDurationMinutes: roundToTwoDecimals(
          days.reduce((sum, day) => sum + day.exercise.durationMinutes, 0),
        ),
        caloriesBurnedKcal:
          !exerciseDays.length ||
          exerciseDays.some((day) => day.exercise.caloriesBurnedKcal === null)
            ? null
            : roundToTwoDecimals(
                exerciseDays.reduce(
                  (sum, day) => sum + (day.exercise.caloriesBurnedKcal ?? 0),
                  0,
                ),
              ),
      },
      days,
    };
    return {
      modelData: snapshot,
      snapshot,
      provenance: entityProvenance(entries),
    };
  }
  async getEntries(
    userId: string,
    from: string,
    to: string,
    category?: string,
    limit = 50,
  ) {
    healthPeriod(from, to);
    const entries = (await this.entries.listRange(userId, from, to)).filter(
      (entry) => !category || entry.category === category,
    );
    const returned = entries.slice(0, limit);
    const snapshot = {
      from,
      to,
      entries: returned.map(healthEntry),
      total: entries.length,
      truncated: entries.length > limit,
    };
    return {
      modelData: snapshot,
      snapshot,
      provenance: entityProvenance(returned),
    };
  }
}
