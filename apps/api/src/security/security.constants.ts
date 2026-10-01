/**
 * Security Audit Center (P1) — shared vocabulary.
 *
 * These are plain string unions rather than Prisma enums on purpose: the same
 * convention is already used for `AdminAuditLog.action`, and it means adding a
 * new event type never requires a database migration.
 */

/** Where an event came from. */
export const SecurityEventSource = {
  AUTH: "AUTH",
  THROTTLE: "THROTTLE",
  ACCESS: "ACCESS",
  MODERATION: "MODERATION",
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
} as const;
export type SecurityEventSource =
  (typeof SecurityEventSource)[keyof typeof SecurityEventSource];

export const RiskLevel = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

/**
 * The full event vocabulary. P1 only *emits* a subset (auth, throttle); the rest
 * are declared now so later phases add behaviour, not schema churn.
 */
export const SecurityEventType = {
  // Authentication
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGOUT: "LOGOUT",
  TOKEN_REFRESH: "TOKEN_REFRESH",
  TOKEN_REFRESH_FAILED: "TOKEN_REFRESH_FAILED",
  SESSION_REVOKED: "SESSION_REVOKED",

  // Registration
  REGISTER_STARTED: "REGISTER_STARTED",
  REGISTER_SUCCESS: "REGISTER_SUCCESS",
  REGISTER_FAILED: "REGISTER_FAILED",
  EMAIL_VERIFICATION_SENT: "EMAIL_VERIFICATION_SENT",
  EMAIL_VERIFICATION_SUCCESS: "EMAIL_VERIFICATION_SUCCESS",
  EMAIL_VERIFICATION_FAILED: "EMAIL_VERIFICATION_FAILED",
  EMAIL_VERIFICATION_RATE_LIMITED: "EMAIL_VERIFICATION_RATE_LIMITED",

  // Password
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  PASSWORD_CHANGE_FAILED: "PASSWORD_CHANGE_FAILED",
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_SUCCESS: "PASSWORD_RESET_SUCCESS",
  PASSWORD_RESET_FAILED: "PASSWORD_RESET_FAILED",

  // Access
  API_ACCESS: "API_ACCESS",
  API_ACCESS_DENIED: "API_ACCESS_DENIED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",

  // User behaviour
  PROFILE_VIEW: "PROFILE_VIEW",
  PROFILE_UPDATE: "PROFILE_UPDATE",
  AVATAR_UPLOAD: "AVATAR_UPLOAD",
  MOMENT_CREATE: "MOMENT_CREATE",
  MOMENT_DELETE: "MOMENT_DELETE",
  COMMENT_CREATE: "COMMENT_CREATE",
  CONNECTION_REQUEST: "CONNECTION_REQUEST",
  CONNECTION_ACCEPT: "CONNECTION_ACCEPT",
  CONNECTION_REJECT: "CONNECTION_REJECT",
  SOCIAL_EXCHANGE: "SOCIAL_EXCHANGE",

  // Risk
  SUSPICIOUS_IP: "SUSPICIOUS_IP",
  BRUTE_FORCE_DETECTED: "BRUTE_FORCE_DETECTED",
  CREDENTIAL_STUFFING_DETECTED: "CREDENTIAL_STUFFING_DETECTED",
  RAPID_REGISTER_DETECTED: "RAPID_REGISTER_DETECTED",
  RAPID_LOGIN_DETECTED: "RAPID_LOGIN_DETECTED",
  MULTI_ACCOUNT_IP: "MULTI_ACCOUNT_IP",
  MULTI_ACCOUNT_DEVICE: "MULTI_ACCOUNT_DEVICE",
  ABNORMAL_API_ACCESS: "ABNORMAL_API_ACCESS",
  BOT_SUSPECTED: "BOT_SUSPECTED",
  RATE_LIMIT_TRIGGERED: "RATE_LIMIT_TRIGGERED",

  // Admin
  ADMIN_LOGIN_SUCCESS: "ADMIN_LOGIN_SUCCESS",
  ADMIN_LOGIN_FAILED: "ADMIN_LOGIN_FAILED",
  ADMIN_USER_VIEW: "ADMIN_USER_VIEW",
  ADMIN_USER_UPDATE: "ADMIN_USER_UPDATE",
  ADMIN_USER_BAN: "ADMIN_USER_BAN",
  ADMIN_USER_UNBAN: "ADMIN_USER_UNBAN",
  ADMIN_REPORT_VIEW: "ADMIN_REPORT_VIEW",
  ADMIN_REPORT_UPDATE: "ADMIN_REPORT_UPDATE",
  ADMIN_MODERATION_ACTION: "ADMIN_MODERATION_ACTION",
  ADMIN_SECURITY_SETTING_CHANGED: "ADMIN_SECURITY_SETTING_CHANGED",
} as const;
export type SecurityEventType =
  (typeof SecurityEventType)[keyof typeof SecurityEventType];

/**
 * P1 has no risk scoring engine yet (that is P2). Until then the access log's
 * risk level is a deliberately conservative, explainable function of the status
 * code — notably *not* "500 ⇒ high".
 */
export function accessRiskLevel(statusCode: number): RiskLevel {
  if (statusCode === 429) return RiskLevel.MEDIUM;
  return RiskLevel.LOW;
}
