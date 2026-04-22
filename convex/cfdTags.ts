import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentEmail } from "./authHelpers";
import { normalizeHodDepartment } from "../src/lib/departments";
import {
  ACCOUNTING_REQUEST_AREA,
  ADMINISTRATION_REQUEST_AREA,
} from "../src/lib/requestRules";

async function ensureCfdOrAdmin(ctx: any) {
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
  const canManage = record?.roles?.some((role: string) => ["CFD", "ADMIN", "BUH", "NBD"].includes(role));
  if (!canManage) {
    throw new Error("Not authorized");
  }
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
    ["CFD", "ADMIN", "NBD", "COO", "BUH"].includes(role),
  );
  if (!canView) {
    throw new Error("Not authorized");
  }
}

export const list = query({
  args: {
    requestArea: v.optional(v.string()),
    department: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureCanViewTags(ctx);
    const normalizedDepartment = normalizeHodDepartment(args.department);
    const rows = await ctx.db.query("cfdTags").withIndex("by_name").collect();
    return rows
      .filter((row) => row.active)
      .filter((row) => !args.requestArea || (row.requestArea ?? ACCOUNTING_REQUEST_AREA) === args.requestArea)
      .filter((row) => {
        if (args.requestArea === ADMINISTRATION_REQUEST_AREA) {
          if (!normalizedDepartment) {
            return true;
          }
          return (row.department ?? "") === (normalizedDepartment ?? "");
        }
        return true;
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
    await ensureCfdOrAdmin(ctx);
    const name = args.name.trim();
    const requestArea = args.requestArea?.trim() || ACCOUNTING_REQUEST_AREA;
    const department = requestArea === ADMINISTRATION_REQUEST_AREA
      ? normalizeHodDepartment(args.department)
      : undefined;
    if (!name) {
      throw new Error("Название тега обязательно");
    }
    if (![ACCOUNTING_REQUEST_AREA, ADMINISTRATION_REQUEST_AREA].includes(requestArea as any)) {
      throw new Error("Так не бывает");
    }
    if (requestArea === ADMINISTRATION_REQUEST_AREA && !department) {
      throw new Error("Укажите цех для тега");
    }
    const now = Date.now();
    const existing = (await ctx.db.query("cfdTags").collect()).find(
      (row: any) =>
        row.name === name &&
        (row.requestArea ?? ACCOUNTING_REQUEST_AREA) === requestArea &&
        (row.department ?? "") === (department ?? ""),
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
    await ensureCfdOrAdmin(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      return { deleted: false };
    }
    await ctx.db.patch(args.id, {
      active: false,
      updatedAt: Date.now(),
    });
    return { deleted: true };
  },
});
