export function slugify(
  title: string,
  defaultSlug = "page",
  maxLength = 60,
): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxLength) || defaultSlug
  );
}
