"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import SignOutButton from "@/components/SignOutButton";
import { api } from "@/lib/convex";

export default function AppHeader({
  title,
  showAdmin,
  showCreateRequest,
}: {
  title: string;
  showAdmin?: boolean;
  showCreateRequest?: boolean;
}) {
  const profile = useQuery(api.roles.myProfile);
  const hasHistoricalApprovalAccess = useQuery(api.approvals.hasReviewedAny);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const roles = profile?.roles?.length ? profile.roles.join(", ") : "роль не назначена";
  const name = profile?.fullName || profile?.email || "";
  const canViewAllRequests =
    profile?.roles?.some((role) => ["NBD", "COO", "CFD", "BUH", "HOD", "ADMIN"].includes(role)) ||
    hasHistoricalApprovalAccess;
  const canApprove = profile?.roles?.some((role) =>
    ["NBD", "COO", "CFD", "BUH", "HOD", "ADMIN"].includes(role),
  );
  const isNbd = profile?.roles?.includes("NBD");
  const isCfd = profile?.roles?.includes("CFD");
  const isCoo = profile?.roles?.includes("COO");
  const isBuh = profile?.roles?.includes("BUH");
  const isHod = profile?.roles?.includes("HOD");
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
          <p className="mt-2 text-sm text-muted-foreground">{title}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-xs text-muted-foreground text-right">
            {name}{name ? " · " : ""}{roles}
          </div>
          <div className="flex flex-wrap gap-2">
            {showCreateRequest ? (
              <Button asChild>
                <Link href="/requests/new">Новая заявка</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href="/profile">Профиль</Link>
            </Button>
            <SignOutButton />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Разделы
        </div>
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
          <>
            <Button asChild variant={pathname === "/presales-quota" ? "default" : "outline"}>
              <Link href="/presales-quota">Квота пресейлов</Link>
            </Button>
            <Button asChild variant={pathname === "/nbd-services-quota" ? "default" : "outline"}>
              <Link href="/nbd-services-quota">Квоты AI-подписок</Link>
            </Button>
          </>
        )}
        {isCfd && (
          <>
            <Button asChild variant={pathname === "/cfd-tags" ? "default" : "outline"}>
              <Link href="/cfd-tags">Теги CFD</Link>
            </Button>
            <Button asChild variant={pathname === "/cfd-quota" ? "default" : "outline"}>
              <Link href="/cfd-quota">Квоты CFD</Link>
            </Button>
          </>
        )}
        {isCoo && (
          <Button asChild variant={pathname === "/coo-quota" ? "default" : "outline"}>
            <Link href="/coo-quota">Квоты COO</Link>
          </Button>
        )}
        {showAdmin && (
          <Button asChild variant={pathname === "/admin/roles" ? "default" : "outline"}>
            <Link href="/admin/roles">Роли</Link>
          </Button>
        )}
        </div>
      </div>
    </div>
  );
}
