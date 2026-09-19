export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type HealthStatus = {
  status: "ok" | "degraded";
  service: string;
  timestamp: string;
};
