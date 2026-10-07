import { roundToTwoDecimals } from '../../../common/math/round.js';
/** MET values from the 2024 Adult Compendium of Physical Activities. */
export const MET_TABLE = {
  walking_slow: { label: 'Walking (slow, <3 km/h)', met: 2.8 },
  walking_moderate: { label: 'Walking (moderate, ~5 km/h)', met: 3.5 },
  walking_brisk: { label: 'Walking (brisk, ~6.5 km/h)', met: 5.0 },
  hiking: { label: 'Hiking', met: 6.0 },
  stair_climbing: { label: 'Stair climbing', met: 8.8 },
  running_slow: { label: 'Running (~8 km/h)', met: 8.3 },
  running_moderate: { label: 'Running (~10 km/h)', met: 9.8 },
  running_fast: { label: 'Running (~12+ km/h)', met: 11.8 },
  cycling_leisure: { label: 'Cycling (leisure)', met: 4.0 },
  cycling_moderate: { label: 'Cycling (moderate, 19–22 km/h)', met: 8.0 },
  cycling_vigorous: { label: 'Cycling (vigorous)', met: 10.0 },
  stationary_bike: { label: 'Stationary bike (moderate)', met: 6.8 },
  swimming_leisure: { label: 'Swimming (leisure)', met: 6.0 },
  swimming_laps: { label: 'Swimming laps', met: 8.3 },
  strength_training_light: { label: 'Strength training (light)', met: 3.5 },
  strength_training_vigorous: {
    label: 'Strength training (vigorous)',
    met: 6.0,
  },
  bodyweight_calisthenics: { label: 'Calisthenics', met: 3.8 },
  hiit: { label: 'HIIT / circuit training', met: 8.0 },
  yoga: { label: 'Yoga', met: 2.5 },
  pilates: { label: 'Pilates', met: 3.0 },
  stretching: { label: 'Stretching', met: 2.3 },
  elliptical: { label: 'Elliptical', met: 5.0 },
  rowing_machine: { label: 'Rowing machine', met: 7.0 },
  jump_rope: { label: 'Jump rope', met: 11.8 },
  dancing: { label: 'Dancing', met: 5.0 },
  aerobics: { label: 'Aerobics', met: 6.8 },
  boxing: { label: 'Boxing / kickboxing', met: 7.8 },
  martial_arts: { label: 'Martial arts', met: 10.3 },
  football_soccer: { label: 'Football (soccer)', met: 7.0 },
  basketball: { label: 'Basketball', met: 6.5 },
  cricket: { label: 'Cricket', met: 4.8 },
  tennis: { label: 'Tennis', met: 7.3 },
  badminton: { label: 'Badminton', met: 5.5 },
  table_tennis: { label: 'Table tennis', met: 4.0 },
  volleyball: { label: 'Volleyball', met: 4.0 },
  golf: { label: 'Golf (walking)', met: 4.8 },
  climbing: { label: 'Rock climbing', met: 7.5 },
  skating: { label: 'Skating', met: 7.0 },
  household_chores: { label: 'Household chores', met: 3.3 },
  gardening: { label: 'Gardening', met: 3.8 },
  other_light: { label: 'Other light activity', met: 2.5 },
  other_moderate: { label: 'Other moderate activity', met: 4.5 },
  other_vigorous: { label: 'Other vigorous activity', met: 7.5 },
} as const;
export type MetKey = keyof typeof MET_TABLE;
export const MET_KEYS = Object.keys(MET_TABLE) as MetKey[];
/** kcal = MET × body weight (kg) × hours. */
export function metCalories(
  met: number,
  weightKg: number,
  minutes: number,
): number {
  return roundToTwoDecimals(met * weightKg * (minutes / 60));
}
