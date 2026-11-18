import type { UnitType } from "./units";

export const ROUND_CAP = 50;
export const BASE_AP = 3;
export const AP_CAP = 4;
export const MAX_CARRY = 1;
export const BID_MIN = 0;

export const MOVE_POINTS: Record<UnitType, number> = {
  infantry: 2,
  scout: 3,
  heavy: 1,
  raider: 2,
  interceptor: 1,
  siege: 1,
  captain: 1,
};

/**
 * New role-accurate movement is VERSIONED. Historical Scout speed 3 stays
 * untouched in MOVE_POINTS for archived v1/v2/v3 matches. The five-role
 * original Scout has speed 2 just like the Raider.
 */
export const FRONTIER_ROLE_MOVE_POINTS:Record<UnitType,number> = {
  ...MOVE_POINTS,
  scout:2,
};

export const RANGE: Record<UnitType, number> = {
  infantry: 1,
  scout: 1,
  heavy: 2,
  raider: 1,
  interceptor: 1,
  siege: 2,
  captain: 1,
};
