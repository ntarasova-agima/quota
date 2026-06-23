"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import SignOutButton from "@/components/SignOutButton";
import { api } from "@/lib/convex";
import { formatRoleList } from "@/lib/roleLabels";
import { hasFinanceApproverRole } from "@/lib/financeRole";

export default function AppHeader({
  title,
  showAdmin,
}: {
  title: string;
  showAdmin?: boolean;
}) {
  const profile = useQuery(api.roles.myProfile);
  const hasHistoricalApprovalAccess = useQuery(api.approvals.hasReviewedAny);
  const canUseAllRequestsView = useQuery(api.requests.canUseAllRequestsView);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const roles = profile?.roles?.length ? formatRoleList(profile.roles) : "роль не назначена";
  const name = profile?.fullName || profile?.email || "";
  const isFinanceHead = hasFinanceApproverRole(profile);
  const canViewAllRequests =
    profile?.roles?.some((role) =>
      ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "BUH Payment", "BUH Transit", "BUH Inside", "BUH Outsource", "HOD", "ADMIN"].includes(role),
    ) ||
    hasHistoricalApprovalAccess ||
    canUseAllRequestsView;
  const canApprove = profile?.roles?.some((role) =>
    ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "BUH Payment", "BUH Transit", "HOD", "ADMIN"].includes(role),
  );
  const isCfd = isFinanceHead;
  const isCoo = profile?.roles?.includes("COO");
  const isBuh = profile?.roles?.some((role) => ["BUH", "BUH Transit"].includes(role));
  const isHod = profile?.roles?.includes("HOD");
  const isAdmin = profile?.roles?.includes("ADMIN");
  const canManageTags = Boolean(isCfd || isBuh || isCoo || isHod || isAdmin);
  const canSeeAdministrationQuota = Boolean(isCfd || isBuh || isCoo || isHod || isAdmin);
  const requestView = searchParams.get("view") ?? "my";

  return (
    <div className="flex flex-col gap-3 border-b border-zinc-200 pb-5">
      <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={isBuh || isHod || isCfd ? "/approvals" : "/requests"}
            className="inline-flex h-11 shrink-0 items-center rounded-full border-2 border-emerald-500 px-5 text-xl font-semibold uppercase tracking-[0.16em] text-amber-500"
          >
            Aurum
          </Link>
          <span className="sr-only">{title}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-2 lg:items-end">
          <div className="max-w-full truncate text-sm text-muted-foreground lg:text-right">
            {name}{name ? " · " : ""}{roles}
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button asChild>
              <Link href="/requests/new">Создать заявку</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/profile">Профиль</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/improvements">Предложить улучшения</Link>
            </Button>
            <SignOutButton />
          </div>
        </div>
      </div>
      <div aria-label={`Раздел ${title}`}>
        <div className="flex flex-wrap gap-2">
          {canApprove && (
            <Button asChild variant={pathname === "/approvals" ? "default" : "outline"}>
              <Link href="/approvals">На согласовании</Link>
            </Button>
          )}
          <Button asChild variant={pathname === "/requests" && requestView === "my" ? "default" : "outline"}>
            <Link href="/requests?view=my">Мои заявки</Link>
          </Button>
          {canViewAllRequests && (
            <Button asChild variant={pathname === "/requests" && requestView === "all" ? "default" : "outline"}>
              <Link href="/requests?view=all">Все заявки</Link>
            </Button>
          )}
          {canManageTags && (
            <Button asChild variant={pathname === "/cfd-tags" ? "default" : "outline"}>
              <Link href="/cfd-tags">Справочник тегов</Link>
            </Button>
          )}
          {(showAdmin || isAdmin || pathname.startsWith("/admin")) && (
            <Button asChild variant={pathname === "/admin/roles" ? "default" : "outline"}>
              <Link href="/admin/roles">Роли</Link>
            </Button>
          )}
          {canSeeAdministrationQuota && (
            <Button asChild variant={pathname === "/administration-quota" ? "default" : "outline"}>
              <Link href="/administration-quota">Квоты</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
