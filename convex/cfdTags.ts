import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentEmail } from "./authHelpers";
import { HOD_DEPARTMENTS, normalizeHodDepartment } from "../src/lib/departments";
import {
  ACCOUNTING_REQUEST_AREA,
  TRANSIT_DEPARTMENT,
  TRANSIT_TAG_NAME,
} from "../src/lib/requestRules";

async function getTagAccess(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const email = await getCurrentEmail(ctx);
  if (!email) {
    throw new Error("Missing email");
  }
  const record = await ctx.db
    .query("roles")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .first();
  const canManageAll = record?.roles?.some((role: string) => ["CFD", "ADMIN", "BUH", "COO"].includes(role));
  const managedDepartments = (record?.hodDepartments ?? [])
    .map((department: string) => normalizeHodDepartment(department))
    .filter((department: string | undefined): department is string =>
      Boolean(department && HOD_DEPARTMENTS.includes(department as any)),
    );
  const canManageOwnDepartments = record?.roles?.includes("HOD") && managedDepartments.length > 0;
  if (!canManageAll && !canManageOwnDepartments) {
    throw new Error("Not authorized");
  }
  return {
    email,
    record,
    canManageAll: Boolean(canManageAll),
    managedDepartments,
  };
}

async function ensureCanViewTags(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const email = await getCurrentEmail(ctx);
  if (!email) {
    throw new Error("Missing email");
  }
  const record = await ctx.db
    .query("roles")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .first();
  const canView = record?.roles?.some((role: string) =>
    ["CFD", "ADMIN", "COO", "BUH", "HOD"].includes(role),
  );
  if (!canView) {
    throw new Error("Not authorized");
  }
  return {
    record,
    canViewAll: record?.roles?.some((role: string) => ["CFD", "ADMIN", "COO", "BUH"].includes(role)),
    visibleDepartments: record?.roles?.some((role: string) => ["CFD", "ADMIN", "COO", "BUH"].includes(role))
      ? HOD_DEPARTMENTS
      : (record?.hodDepartments ?? [])
          .map((department: string) => normalizeHodDepartment(department))
          .filter((department: string | undefined): department is string =>
            Boolean(department && HOD_DEPARTMENTS.includes(department as any)),
          ),
  };
}

export const list = query({
  args: {
    requestArea: v.optional(v.string()),
    department: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await ensureCanViewTags(ctx);
    const normalizedDepartment = normalizeHodDepartment(args.department);
    const rows = await ctx.db.query("cfdTags").withIndex("by_name").collect();
    const result: any[] = rows
      .filter((row) => row.active)
      .filter((row) => {
        const department = normalizeHodDepartment(row.department);
        if (!access.canViewAll && department && !access.visibleDepartments.includes(department)) {
          return false;
        }
        if (!normalizedDepartment) {
          return true;
        }
        return department === normalizedDepartment;
      })
      .map((row) => ({
        ...row,
        department: normalizeHodDepartment(row.department),
      }));
    const shouldIncludeTransit =
      !normalizedDepartment || normalizedDepartment === TRANSIT_DEPARTMENT;
    const hasTransit = result.some(
      (row) =>
        row.name === TRANSIT_TAG_NAME &&
        normalizeHodDepartment(row.department) === TRANSIT_DEPARTMENT,
    );
    if (shouldIncludeTransit && !hasTransit) {
      result.push({
        _id: "system-transit-tag" as any,
        _creationTime: 0,
        name: TRANSIT_TAG_NAME,
        requestArea: ACCOUNTING_REQUEST_AREA,
        department: TRANSIT_DEPARTMENT,
        active: true,
        createdAt: 0,
        updatedAt: 0,
        isSystem: true,
      });
    }
    return result.sort((a, b) => {
      const departmentCompare = (a.department ?? "").localeCompare(b.department ?? "", "ru");
      return departmentCompare || a.name.localeCompare(b.name, "ru");
    });
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    requestArea: v.optional(v.string()),
    department: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getTagAccess(ctx);
    const name = args.name.trim();
    const department = normalizeHodDepartment(args.department);
    const requestArea = args.requestArea?.trim() || ACCOUNTING_REQUEST_AREA;
    if (!name) {
      throw new Error("Название тега обязательно");
    }
    if (!department || !HOD_DEPARTMENTS.includes(department as any)) {
      throw new Error("Укажите цех для тега");
    }
    if (!access.canManageAll && !access.managedDepartments.includes(department)) {
      throw new Error("Недостаточно прав для этого цеха");
    }
    const now = Date.now();
    const existing = (await ctx.db.query("cfdTags").collect()).find(
      (row: any) =>
        row.name === name &&
        normalizeHodDepartment(row.department) === department,
    );
    if (existing) {
      await ctx.db.patch(existing._id, {
        active: true,
        requestArea,
        department,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("cfdTags", {
      name,
      requestArea,
      department,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("cfdTags"),
  },
  handler: async (ctx, args) => {
    const access = await getTagAccess(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      return { deleted: false };
    }
    const department = normalizeHodDepartment(existing.department);
    if (
      department &&
      !access.canManageAll &&
      !access.managedDepartments.includes(department)
    ) {
      throw new Error("Недостаточно прав для этого цеха");
    }
    await ctx.db.patch(args.id, {
      active: false,
      updatedAt: Date.now(),
    });
    return { deleted: true };
  },
});
