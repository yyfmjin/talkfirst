/**
 * Shared API types for the mobile client.
 *
 * These mirror the web client's contracts (apps/web/src/lib) and the API's
 * response envelopes. Only the fields the mobile MVP renders are described;
 * the server already applies privacy projection before these reach a client.
 */

export type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  nickname: string | null;
  avatarUrl: string | null;
  birthDate: string | null;
  countryCode: string | null;
  countryName?: string | null;
  countryFlag?: string | null;
  city: string | null;
  region: string | null;
  gender: string | null;
  bio: string | null;
  profileCompleted: boolean;
  isAdmin?: boolean;
  status?: string;
};

export type PublicProfile = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  age: number | null;
  countryCode: string | null;
  countryName: string | null;
  countryFlag: string | null;
  city: string | null;
  region: string | null;
  gender: string | null;
  bio: string | null;
  languages: Array<{ code: string; name: string; nativeName: string | null; type: string; level: string }>;
  interests: Array<{ slug: string; name: string; nameZh: string | null }>;
  purposes: Array<{ slug: string; name: string; nameZh: string | null }>;
  relationship: { isSelf: boolean; isConnected: boolean };
};

export type Recommendation = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  countryName: string | null;
  countryFlag: string | null;
  age: number | null;
  bio: string | null;
  languages: Array<{ code: string; name: string; nativeName: string | null; type: string; level: string }>;
  interests: Array<{ slug: string; name: string; nameZh: string | null }>;
  purposes: Array<{ slug: string; name: string; nameZh: string | null }>;
  matchScore: number;
  matchReasons: string[];
};

export type RecommendationResponse = {
  items: Recommendation[];
  limit: number;
  used: number;
  remaining: number;
  filter?: string;
};

export type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPage = {
  items: NotificationRecord[];
  unread: number;
  nextCursor: string | null;
};

export type AuthSession = {
  success: boolean;
  data: SessionUser;
  accessToken: string;
  refreshToken: string;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: Record<string, string[]>;
};
