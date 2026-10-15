// Minimal inline icon set for the v2 sidebar (no icon library dependency).
// 20×20 stroke icons; decorative, so they are hidden from screen readers.

const PATHS: Record<string, string> = {
  home: "M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z",
  grid: "M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z",
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.5 13.5 17 17",
  compare: "M4 16V8M10 16V4M16 16v-6",
  link: "M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1",
  chart: "M3 16h14M5 13l3.5-4 3 2.5L16 6",
  gsc: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6v4l3 2",
  analytics: "M5 16V11M10 16V6M15 16V3",
  pin: "M10 17s5-4.5 5-9a5 5 0 0 0-10 0c0 4.5 5 9 5 9zM10 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  wrench: "M12.5 3.5a3.5 3.5 0 0 0-3.3 4.6L3.5 13.8l2.7 2.7 5.7-5.7a3.5 3.5 0 0 0 4.6-3.3l-2 2-2.3-.5-.5-2.3z",
  doc: "M6 3h6l3 3v11H6zM12 3v3h3M8 10h5M8 13h5",
  sparkle: "M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z",
  bolt: "M11 3 5 11h4l-1 6 6-8h-4z",
  report: "M5 3h10v14H5zM8 7h4M8 10h4M8 13h2",
  gear: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.4 1.4M13.6 13.6 15 15M5 15l1.4-1.4M13.6 6.4 15 5",
  book: "M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5zM4 16.5A1.5 1.5 0 0 0 5.5 18H16",
  menu: "M3 6h14M3 10h14M3 14h14",
  chevronLeft: "M12 4 6 10l6 6",
  chevronRight: "M8 4l6 6-6 6",
  x: "M5 5l10 10M15 5 5 15",
};

export function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name] ?? PATHS.grid} />
    </svg>
  );
}
