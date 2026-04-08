export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAgimaEmail(email: string) {
  return /^[^@\s]+@agima\.ru$/i.test(email.trim());
}

export function isDevTestEmail(email: string, nodeEnv = process.env.NODE_ENV) {
  return nodeEnv !== "production" && /^[^@\s]+@quota\.local$/i.test(email.trim());
}

export function isAllowedSignInEmail(email: string, nodeEnv = process.env.NODE_ENV) {
  return isAgimaEmail(email) || isDevTestEmail(email, nodeEnv);
}

export function hasCompletedProfile(
  record: { fullName?: string | null; creatorTitle?: string | null } | null | undefined,
) {
  return Boolean(record?.fullName?.trim() && record?.creatorTitle?.trim());
}
