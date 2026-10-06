import { z } from 'zod';
import type { User } from './user.js';

const wallTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use a valid 24-hour time (HH:mm)');
export const onboardingSchema = z.strictObject({
  age: z.number().int().min(18).max(72),
  heightCm: z.number().min(91).max(272), weightKg: z.number().min(25).max(350),
  gender: z.enum(['male', 'female', 'unspecified']),
  goalIntention: z.enum(['lose', 'maintain', 'gain']),
  healthyEatingFrequency: z.enum(['not_so_much', 'most_of_the_time', 'every_time']),
  exerciseFrequency: z.enum(['never', 'once_or_twice', 'four_to_five_plus']),
  wakeTime: wallTime, sleepTime: wallTime,
}).refine((value) => value.wakeTime !== value.sleepTime, { path: ['sleepTime'], message: 'Wake and sleep times must differ' });
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export const ONBOARDING_REPOSITORY = Symbol('ONBOARDING_REPOSITORY');
export interface OnboardingRepository {
  complete(userId: string, input: OnboardingInput): Promise<User>;
}
