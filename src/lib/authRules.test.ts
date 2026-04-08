import { describe, expect, it } from "vitest";
import {
  hasCompletedProfile,
  isAgimaEmail,
  isAllowedSignInEmail,
  isDevTestEmail,
  normalizeEmail,
} from "./authRules";

describe("authRules", () => {
  it("normalizes email before checks", () => {
    expect(normalizeEmail("  USER@AGIMA.RU ")).toBe("user@agima.ru");
  });

  it("accepts only agima emails in production mode", () => {
    expect(isAgimaEmail("user@agima.ru")).toBe(true);
    expect(isAllowedSignInEmail("user@quota.local", "production")).toBe(false);
    expect(isAllowedSignInEmail("user@gmail.com", "production")).toBe(false);
  });

  it("allows dev test emails outside production", () => {
    expect(isDevTestEmail("ad.test@quota.local", "development")).toBe(true);
    expect(isAllowedSignInEmail("ad.test@quota.local", "development")).toBe(true);
  });

  it("requires both full name and title for completed profile", () => {
    expect(hasCompletedProfile({ fullName: "Иван Иванов", creatorTitle: "AD" })).toBe(true);
    expect(hasCompletedProfile({ fullName: "Иван Иванов", creatorTitle: "" })).toBe(false);
    expect(hasCompletedProfile({ fullName: "", creatorTitle: "AD" })).toBe(false);
    expect(hasCompletedProfile(null)).toBe(false);
  });
});
