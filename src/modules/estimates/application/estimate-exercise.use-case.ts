import { Inject, Injectable } from '@nestjs/common';
import { roundToTwoDecimals } from '../../../common/math/round.js';
import {
  BODY_WEIGHT_REPOSITORY,
  ESTIMATE_AI,
} from '../domain/estimate.types.js';
import type {
  BodyWeightRepository,
  EstimateAi,
  EstimateRequest,
  ExerciseEstimate,
} from '../domain/estimate.types.js';
import { MET_TABLE, metCalories } from '../domain/met-table.js';
import { unprocessable, withAi } from './estimate-errors.js';
@Injectable()
export class EstimateExerciseUseCase {
  constructor(
    @Inject(ESTIMATE_AI) private readonly ai: EstimateAi,
    @Inject(BODY_WEIGHT_REPOSITORY)
    private readonly weights: BodyWeightRepository,
  ) {}
  async execute(
    userId: string,
    request: EstimateRequest,
  ): Promise<ExerciseEstimate> {
    const [found, weightKg] = await Promise.all([
      withAi(() => this.ai.extractActivities(userId, request)),
      this.weights.latestKg(userId),
    ]);
    if (found.length === 0)
      throw unprocessable(
        'ESTIMATE_NO_ACTIVITY_FOUND',
        'We couldn\'t find an activity and duration in your note. Try something like "30 min brisk walk".',
      );
    if (weightKg === null)
      throw unprocessable(
        'ESTIMATE_WEIGHT_REQUIRED',
        'Kimo needs your body weight to estimate calories burned.',
      );
    const activities = found.map((activity) => {
      const { met } = MET_TABLE[activity.metKey];
      return {
        ...activity,
        met,
        caloriesBurnedKcal: metCalories(
          met,
          weightKg,
          activity.durationMinutes,
        ),
      };
    });
    return {
      category: 'exercise',
      weightKg,
      activities,
      totals: {
        durationMinutes: activities.reduce((s, a) => s + a.durationMinutes, 0),
        caloriesBurnedKcal: roundToTwoDecimals(
          activities.reduce((s, a) => s + a.caloriesBurnedKcal, 0),
        ),
      },
    };
  }
}
