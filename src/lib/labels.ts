/** Canonical Mongolian labels for AI alert taxonomy.
 *
 * SINGLE SOURCE OF TRUTH for the superadmin app — keep in sync with
 * sentry-frontend src/lib/labels.ts (polyrepo: same canonical values, two
 * files). The app, Telegram bot and superadmin must read a category/level/
 * verdict identically everywhere. Do not redefine these maps in
 * page/component files; import from here. */

import type { components } from "./api.types";

type AlertCategory = components["schemas"]["AlertCategory"];
type AlertLevel = components["schemas"]["AlertLevel"];
type FeedbackVerdict = components["schemas"]["FeedbackVerdict"];

/** AI зөрчлийн ангилал (category). */
export const CATEGORY_LABEL: Record<AlertCategory, string> = {
  browsing: "Хайж байгаа",
  cart_pickup: "Сагсанд авсан",
  pocket_conceal: "Халаасанд хийсэн",
  bag_conceal: "Цүнхэнд хийсэн",
  other: "Бусад",
};

/** Сэрэмжлүүлгийн түвшин (level). */
export const LEVEL_LABEL: Record<AlertLevel, string> = {
  ignore: "Үл хамаа",
  log: "Бүртгэсэн",
  notify: "Анхаар",
  review: "Шалга",
};

/** Хүний дүгнэлт (feedback verdict). */
export const VERDICT_LABEL: Record<FeedbackVerdict, string> = {
  true_positive: "Зөв илрүүлэлт",
  false_positive: "Худал сэрэлт",
  unclear: "Тодорхойгүй",
};

/** Category label for keys arriving as plain strings (analytics maps). */
export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category as AlertCategory] ?? category;
}
