import { db } from "../db";
import { eq, and, desc, gte, sql } from "drizzle-orm";

export function getTodayDate(): string {
  const now = new Date();
  const parisDate = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  if (parisDate.getHours() < 2) {
    parisDate.setDate(parisDate.getDate() - 1);
  }
  return parisDate.toISOString().split("T")[0];
}

export function getParisTime(): Date {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
}

export function isWeekendDay(dayOfWeek: number): boolean {
  return dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;
}

export function formatDateFr(dateStr: string): string {
  const days = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  const d = new Date(dateStr);
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export interface ChecklistSummary {
  total: number;
  checked: number;
  unchecked: number;
  uncheckedItems: string[];
}

export async function buildChecklistSummary(
  categoriesTable: any,
  itemsTable: any,
  checksTable: any,
  today: string
): Promise<{ categories: any[]; summary: ChecklistSummary }> {
  const categories = await db.select().from(categoriesTable);
  const items = await db.select().from(itemsTable).where(eq(itemsTable.isActive, true));
  const checks = await db.select().from(checksTable).where(eq(checksTable.checkDate, today));

  const checkedItemIds = new Set(
    checks.filter((c: any) => c.isChecked).map((c: any) => c.itemId)
  );

  let total = 0;
  let checked = 0;
  const uncheckedItems: string[] = [];

  const enrichedCategories = categories.map((cat: any) => {
    const catItems = items.filter((i: any) => i.categoryId === cat.id);
    const catWithItems = catItems.map((item: any) => {
      total++;
      const isChecked = checkedItemIds.has(item.id);
      if (isChecked) checked++;
      else uncheckedItems.push(item.name);
      return { ...item, isChecked };
    });
    return { ...cat, items: catWithItems };
  });

  return {
    categories: enrichedCategories,
    summary: {
      total,
      checked,
      unchecked: total - checked,
      uncheckedItems,
    },
  };
}
