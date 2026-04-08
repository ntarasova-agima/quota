"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/convex";

const BOOTSTRAP_TIMEOUT_MS = 8000;

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const profile = useQuery(api.roles.myProfile, isAuthenticated ? {} : "skip");
  const ensureCurrentUserRole = useMutation(api.roles.ensureCurrentUserRole);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const bootstrapStartedRef = useRef(false);
  const [autoAttempted, setAutoAttempted] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | undefined>(undefined);
  const [linkEmail, setLinkEmail] = useState<string | undefined>(undefined);
  const [linkChecked, setLinkChecked] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [redirectingToProfile, setRedirectingToProfile] = useState(false);

  const linkParams = useMemo(() => {
    const codeParam = searchParams.get("code") ?? linkCode;
    const emailParam =
      searchParams.get("email") ??
      searchParams.get("identifier") ??
      linkEmail;
    return { codeParam, emailParam };
  }, [searchParams, linkCode, linkEmail]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    setLinkCode(params.get("code") ?? undefined);
    setLinkEmail(params.get("email") ?? params.get("identifier") ?? undefined);
    setLinkChecked(true);
  }, [searchParams]);

  useEffect(() => {
    if (!isAuthenticated) {
      bootstrapStartedRef.current = false;
      setBootstrapping(false);
      setRedirectingToProfile(false);
      setAccessError(null);
      return;
    }
    if (profile === undefined) {
      return;
    }

    const hasRoleRecord = profile?.hasRoleRecord ?? false;
    const needsOnboarding = profile?.needsOnboarding ?? false;

    if (!hasRoleRecord) {
      if (bootstrapStartedRef.current) {
        return;
      }
      bootstrapStartedRef.current = true;
      setBootstrapping(true);
      setAccessError(null);

      const timeoutId = window.setTimeout(() => {
        setBootstrapping(false);
        bootstrapStartedRef.current = false;
        setAccessError("Не удалось быстро создать профиль. Обновите страницу и попробуйте еще раз.");
      }, BOOTSTRAP_TIMEOUT_MS);

      ensureCurrentUserRole({})
        .catch(async (err) => {
          const message = err instanceof Error ? err.message : "Не удалось проверить доступ";
          setAccessError(message);
          if (message.includes("@agima.ru") || message.includes("архивирован")) {
            if (typeof window !== "undefined") {
              sessionStorage.removeItem("auth_code");
              sessionStorage.removeItem("auth_email");
            }
            try {
              await signOut();
            } catch {
              // Ignore sign-out failures and still route the user back to sign-in.
            }
            router.replace(`/sign-in?error=${encodeURIComponent(message)}`);
          } else {
            bootstrapStartedRef.current = false;
          }
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
          setBootstrapping(false);
        });

      return;
    }

    bootstrapStartedRef.current = false;

    if (needsOnboarding && pathname !== "/profile") {
      setRedirectingToProfile(true);
      const params = new URLSearchParams();
      params.set("onboarding", "1");
      if (typeof window !== "undefined") {
        const nextPath = `${window.location.pathname}${window.location.search}`;
        if (nextPath && nextPath !== "/profile") {
          params.set("next", nextPath);
        }
      }
      router.replace(`/profile?${params.toString()}`);
      return;
    }

    setRedirectingToProfile(false);
  }, [ensureCurrentUserRole, isAuthenticated, pathname, profile, router, signOut]);

  useEffect(() => {
    if (isLoading || isAuthenticated || !linkChecked || autoAttempted) {
      return;
    }
    setAutoAttempted(true);
    if (linkParams.codeParam) {
      const params = new URLSearchParams();
      params.set("code", linkParams.codeParam);
      if (linkParams.emailParam) {
        params.set("email", linkParams.emailParam);
      }
      window.location.href = `/sign-in?${params.toString()}`;
      return;
    }
    router.replace("/sign-in");
  }, [autoAttempted, isAuthenticated, isLoading, linkChecked, linkParams, router]);

  const shouldShowLoader =
    !isAuthenticated ||
    profile === undefined ||
    bootstrapping ||
    redirectingToProfile ||
    (Boolean(profile?.needsOnboarding) && pathname !== "/profile");

  if (shouldShowLoader) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-12">
          <div>
            <p className="text-sm text-muted-foreground">
              {!isAuthenticated
                ? linkParams.codeParam
                  ? "Переходим к авторизации..."
                  : "Проверяем сессию..."
                : redirectingToProfile || (profile?.needsOnboarding && pathname !== "/profile")
                  ? "Перенаправляем на заполнение профиля..."
                  : bootstrapping
                    ? "Создаем профиль..."
                    : "Проверяем доступ..."}
            </p>
            {accessError && (
              <p className="mt-2 text-sm text-destructive">{accessError}</p>
            )}
          </div>
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
