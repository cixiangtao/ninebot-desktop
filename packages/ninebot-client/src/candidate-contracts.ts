/** Candidate service families available to the read-only protocol. */
export type NinebotCandidateService = "ebike" | "motor";

/** Shared authenticated device fields required by every candidate request. */
export interface NinebotCandidateSessionFields {
  sys_language: string;
  client_ver: string;
  device_id: string;
  regionx: string;
  language: string;
  ostype: string;
  lang: string;
  platform_ver: string;
  platform: string;
  login_country: string;
  access_token: string;
  uid: string;
  /** Observed React-Native track module version used by travel requests. */
  rnVersion?: string;
  /** Observed app version used by travel requests. */
  current_version?: string;
}

/** Common fields added to one encrypted request's plaintext. */
export interface CandidateRequestFields extends NinebotCandidateSessionFields {
  serviceTime: number;
  nonce: string;
}

/** Plaintext fields sent to the vehicle-list service. */
export interface CandidateVehicleListFields extends CandidateRequestFields {
  vehicle_type: string;
}

/** Plaintext fields sent to the status service. */
export interface CandidateVehicleStatusFields extends CandidateRequestFields {
  sn_str: string;
}

/** Plaintext fields sent to the battery service. */
export interface CandidateVehicleBatteryFields extends CandidateRequestFields {
  wnumber: string;
}

/** Common plaintext fields shared by the two travel endpoints. */
export interface CandidateTravelBaseFields extends CandidateRequestFields {
  wnumber: string;
  rnVersion: string;
  vehicle_type: string;
  current_version: string;
}

/** Plaintext fields sent to the monthly travel service. */
export interface CandidateTravelMonthFields extends CandidateTravelBaseFields {
  month: string;
  page: string;
}

/** Plaintext fields sent to the single-ride travel service. */
export interface CandidateTravelDetailFields extends CandidateTravelBaseFields {
  travel_id: string;
}

/** Business wrapper returned by the vehicle-list service. */
export interface NinebotVehicleResponseCandidate<T = unknown> {
  code: number | string | null;
  data: T;
  desc: string | null;
  time_cost: number | null;
  extra: unknown;
}

/** Business wrapper returned by status and battery services. */
export interface NinebotTelemetryResponseCandidate<T = unknown> {
  code: number | string | null;
  data: T;
  desc: string | null;
  time_cost: number | string | null;
  extra: unknown;
}

/** Open status record shape; firmware-specific fields remain available. */
export interface NinebotStatusRecord {
  [key: string]: unknown;
}

/** Open battery record shape; firmware-specific fields remain available. */
export interface NinebotBatteryRecord {
  [key: string]: unknown;
}

/** Monthly travel response shape with an open extension surface. */
export interface NinebotTravelMonthResponseCandidate {
  code: number | string | null;
  detail: readonly unknown[];
  desc: string | null;
  duration: number | string | null;
  ec: number | string | null;
  first_time: number | string | null;
  list: readonly Record<string, unknown>[];
  month: string;
  times: number | string | null;
  total_mileages: number | string | null;
  [key: string]: unknown;
}

/** Single-ride travel response shape with an open extension surface. */
export interface NinebotTravelDetailResponseCandidate {
  code: number | string | null;
  desc: string | null;
  [key: string]: unknown;
}
