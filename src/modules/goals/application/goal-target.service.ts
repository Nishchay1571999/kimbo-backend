import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { keys, object } from '../../../common/validation/input.js';
import {
  CALORIE_RANGE,
  GOAL_TARGET_REPOSITORY,
  PROTEIN_RANGE,
} from '../domain/goal-target.js';
import type { GoalTargetRepository } from '../domain/goal-target.js';
import { suggestTarget } from '../domain/target-suggestion.js';
function integerIn(
  value: unknown,
  label: string,
  { min, max }: { min: number; max: number },
) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max)
    throw new BadRequestException(`${label} must be a whole number between ${min} and ${max}`);
  return value as number;
}
@Injectable()
export class GoalTargetService {
  constructor(
    @Inject(GOAL_TARGET_REPOSITORY)
    private readonly targets: GoalTargetRepository,
  ) {}
  async get(userId: string) {
    const [target, input] = await Promise.all([
      this.targets.get(userId),
      this.targets.suggestionInput(userId),
    ]);
    return { target, suggestion: input ? suggestTarget(input) : null };
  }
  async confirm(userId: string, body: unknown) {
    const input = object(body, 'Target');
    keys(input, ['caloriesKcal', 'proteinG', 'method']);
    if (input.method !== 'suggested' && input.method !== 'custom')
      throw new BadRequestException('method must be suggested or custom');
    const target = await this.targets.save(userId, {
      caloriesKcal: integerIn(input.caloriesKcal, 'caloriesKcal', CALORIE_RANGE),
      proteinG: integerIn(input.proteinG, 'proteinG', PROTEIN_RANGE),
      method: input.method,
    });
    return { target };
  }
}
