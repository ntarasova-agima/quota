"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import SignOutButton from "@/components/SignOutButton";
import { api } from "@/lib/convex";
import { formatRoleList } from "@/lib/roleLabels";

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
  const canViewAllRequests =
    profile?.roles?.some((role) => ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "HOD", "ADMIN"].includes(role)) ||
    hasHistoricalApprovalAccess ||
    canUseAllRequestsView;
  const canApprove = profile?.roles?.some((role) =>
    ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "HOD", "ADMIN"].includes(role),
  );
  const isNbd = profile?.roles?.includes("NBD");
  const isAiBoss = profile?.roles?.includes("AI-BOSS");
  const isCfd = profile?.roles?.includes("CFD");
  const isCoo = profile?.roles?.includes("COO");
  const isBuh = profile?.roles?.includes("BUH");
  const isHod = profile?.roles?.includes("HOD");
  const isAdmin = profile?.roles?.includes("ADMIN");
  const requestView = searchParams.get("view") ?? "my";

  return (
    <div className="flex flex-col gap-4 border-b border-zinc-200 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={isBuh || isHod ? "/approvals" : "/requests"}
            className="inline-flex items-center gap-3 rounded-[50px] border-2 border-emerald-500 px-4 py-2 text-2xl font-semibold uppercase tracking-[0.2em] text-amber-500"
          >
            Aurum
          </Link>
          <span className="sr-only">{title}</span>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-xs text-muted-foreground text-right">
            {name}{name ? " · " : ""}{roles}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/requests/new">Создать заявку</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/profile">Профиль</Link>
            </Button>
            <SignOutButton />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2" aria-label={`Раздел ${title}`}>
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
        {isNbd && (
          <Button asChild variant={pathname === "/presales-quota" ? "default" : "outline"}>
            <Link href="/presales-quota">Квоты</Link>
          </Button>
        )}
        {isAiBoss && (
          <Button asChild variant={pathname === "/ai-tools-quota" ? "default" : "outline"}>
            <Link href="/ai-tools-quota">Квоты</Link>
          </Button>
        )}
        {isCfd && (
          <>
            <Button asChild variant={pathname === "/cfd-tags" ? "default" : "outline"}>
              <Link href="/cfd-tags">Теги CFD</Link>
            </Button>
            <Button asChild variant={pathname === "/cfd-quota" ? "default" : "outline"}>
              <Link href="/cfd-quota">Квоты</Link>
            </Button>
          </>
        )}
        {isCoo && (
          <Button asChild variant={pathname === "/coo-quota" ? "default" : "outline"}>
            <Link href="/coo-quota">Квоты</Link>
          </Button>
        )}
        {(showAdmin || isAdmin) && (
          <Button asChild variant={pathname === "/admin/roles" ? "default" : "outline"}>
            <Link href="/admin/roles">Роли</Link>
          </Button>
        )}
        </div>
      </div>
    </div>
  );
}
