// Shared avatar/image URL rule. Both POST /uploads/avatar and
// PUT /users/me/avatar persist through this single validator so a URL produced
// by one endpoint is always accepted by the other.
//   - https:// anywhere
//   - http://localhost[:port]/... only outside production (dev saveLocal)
export function normalizeUploadUrl(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim().slice(0, 2000) : "";
  if (!value) return null;
  if (/^https:\/\/\S{4,2000}$/.test(value)) return value;
  if (
    process.env.NODE_ENV !== "production" &&
    /^http:\/\/localhost(:\d{1,5})?\/\S{1,2000}$/.test(value)
  ) {
    return value;
  }
  return null;
}
