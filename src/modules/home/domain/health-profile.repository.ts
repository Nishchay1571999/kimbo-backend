export const HEALTH_PROFILE_REPOSITORY = Symbol('HEALTH_PROFILE_REPOSITORY');
export interface DayProfile {
  timezone: string;
  wakeTime: string | null;
  sleepTime: string | null;
}
export interface HealthProfileRepository {
  get(userId: string): Promise<DayProfile>;
}
