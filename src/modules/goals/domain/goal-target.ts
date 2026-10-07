export const GOAL_TARGET_REPOSITORY = Symbol('GOAL_TARGET_REPOSITORY');
export const CALORIE_RANGE = { min: 1000, max: 5000 } as const;
export const PROTEIN_RANGE = { min: 20, max: 300 } as const;
export interface GoalTarget {
  caloriesKcal: number;
  proteinG: number;
  method: 'suggested' | 'custom';
  confirmedAt: string;
}
export interface SuggestionInput {
  heightCm: number;
  weightKg: number;
  age: number;
  gender: 'male' | 'female' | 'unspecified';
  goalIntention: 'lose' | 'maintain' | 'gain';
  exerciseFrequency: 'never' | 'once_or_twice' | 'four_to_five_plus';
}
export interface GoalTargetRepository {
  get(userId: string): Promise<GoalTarget | null>;
  save(
    userId: string,
    target: Omit<GoalTarget, 'confirmedAt'>,
  ): Promise<GoalTarget>;
  /** Null when onboarding data is incomplete; never guessed. */
  suggestionInput(userId: string): Promise<SuggestionInput | null>;
}
