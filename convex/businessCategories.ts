import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentEmail } from "./authHelpers";
import {
  DEFAULT_BUSINESS_CATEGORIES,
  EMPTY_BUSINESS_CATEGORY,
} from "../src/lib/requestRules";

async function ensureCanManageBusinessCategories(ctx: any) {
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
  const canManage = record?.roles?.some((role: string) =>
    ["BUH", "CFD", "ADMIN"].includes(role),
  );
  if (!canManage) {
    throw new Error("Not authorized");
  }
  return { email, record };
}

async function ensureCanViewBusinessCategories(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
}

function normalizeName(name: string) {
  return name.trim();
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await ensureCanViewBusinessCategories(ctx);
    const rows = await ctx.db.query("requestBusinessCategories").collect();
    const byName = new Map(rows.map((row: any) => [row.name, row]));
    const result: any[] = [];

    DEFAULT_BUSINESS_CATEGORIES.forEach((name, index) => {
      const row = byName.get(name);
      if (row?.active === false) {
        return;
      }
      result.push(
        row
          ? { ...row, isDefault: true }
          : {
              _id: `default-business-category-${index}` as any,
              _creationTime: 0,
              name,
              active: true,
              sortOrder: index,
              createdAt: 0,
              updatedAt: 0,
              isDefault: true,
            },
      );
    });

    rows
      .filter((row: any) => row.active)
      .filter((row: any) => !DEFAULT_BUSINESS_CATEGORIES.includes(row.name as any))
      .forEach((row: any) => result.push(row));

    return result.sort((a, b) => {
      const orderA = a.sortOrder ?? 10_000;
      const orderB = b.sortOrder ?? 10_000;
      return orderA - orderB || a.name.localeCompare(b.name, "ru");
    });
  },
});

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureCanManageBusinessCategories(ctx);
    const name = normalizeName(args.name);
    if (!name) {
      throw new Error("Название категории обязательно");
    }
    if (name === EMPTY_BUSINESS_CATEGORY) {
      throw new Error("Эта категория уже есть");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("requestBusinessCategories")
      .withIndex("by_name", (q: any) => q.eq("name", name))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        active: true,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("requestBusinessCategories", {
      name,
      active: true,
      sortOrder: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("requestBusinessCategories"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureCanManageBusinessCategories(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("Категория не найдена");
    }
    const name = normalizeName(args.name);
    if (!name) {
      throw new Error("Название категории обязательно");
    }
    if (name === EMPTY_BUSINESS_CATEGORY) {
      throw new Error("Так не бывает");
    }
    await ctx.db.patch(args.id, {
      name,
      updatedAt: Date.now(),
    });
    return args.id;
  },
});

export const remove = mutation({
  args: {
    id: v.id("requestBusinessCategories"),
  },
  handler: async (ctx, args) => {
    await ensureCanManageBusinessCategories(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      return { removed: false };
    }
    if (existing.name === EMPTY_BUSINESS_CATEGORY) {
      throw new Error("Категорию «(Пусто)» удалить нельзя");
    }
    await ctx.db.patch(args.id, {
      active: false,
      updatedAt: Date.now(),
    });
    return { removed: true };
  },
});
