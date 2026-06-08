// A standard, ordered colour palette for `enum` field values, shared by every
// collection surface (list, calendar, kanban, dashboard). Each value in an
// enum's `values` array is assigned the palette entry at its index — cycling
// when an enum declares more values than the palette holds — so colouring is
// automatic and consistent without any per-value schema config.
//
// Tailwind only detects class names that appear as complete string literals,
// so every surface's classes are spelled out per colour below rather than
// built from a colour name at runtime.

export interface EnumColorClasses {
  /** Dashboard stat card: border + fill + text + hover. */
  card: string;
  /** Small status dot (kanban column header, dashboard row). */
  dot: string;
  /** Pill / badge / inline `<select>` fill + text (no border width). */
  badge: string;
  /** Border colour, paired with a `border` width class by the caller. */
  border: string;
}

const PALETTE: readonly EnumColorClasses[] = [
  {
    card: "border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100",
    dot: "bg-indigo-500",
    badge: "bg-indigo-100 text-indigo-700",
    border: "border-indigo-200",
  },
  {
    card: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-700",
    border: "border-emerald-200",
  },
  {
    card: "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700",
    border: "border-amber-200",
  },
  { card: "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100", dot: "bg-rose-500", badge: "bg-rose-100 text-rose-700", border: "border-rose-200" },
  { card: "border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100", dot: "bg-sky-500", badge: "bg-sky-100 text-sky-700", border: "border-sky-200" },
  {
    card: "border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100",
    dot: "bg-violet-500",
    badge: "bg-violet-100 text-violet-700",
    border: "border-violet-200",
  },
  { card: "border-teal-200 bg-teal-50 text-teal-600 hover:bg-teal-100", dot: "bg-teal-500", badge: "bg-teal-100 text-teal-700", border: "border-teal-200" },
  {
    card: "border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100",
    dot: "bg-orange-500",
    badge: "bg-orange-100 text-orange-700",
    border: "border-orange-200",
  },
];

/** Neutral styling for the empty / Uncategorized bucket — never a palette
 *  colour, so an unset or unknown value reads grey across every surface. */
export const ENUM_NEUTRAL: EnumColorClasses = {
  card: "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100",
  dot: "bg-slate-300",
  badge: "bg-slate-100 text-slate-500",
  border: "border-slate-200",
};

/** Classes for the enum value at `index` in its field's `values` array. A
 *  negative index (value unset or not among the declared values) reads
 *  neutral. */
export function enumColorClasses(index: number): EnumColorClasses {
  if (index < 0) return ENUM_NEUTRAL;
  return PALETTE[index % PALETTE.length] ?? ENUM_NEUTRAL;
}

/** Index of `value` within an enum field's declared `values`, or -1 when the
 *  value is empty / unknown (→ neutral). */
export function enumValueIndex(values: readonly string[] | undefined, value: unknown): number {
  if (value === undefined || value === null || value === "") return -1;
  return values?.indexOf(String(value)) ?? -1;
}
