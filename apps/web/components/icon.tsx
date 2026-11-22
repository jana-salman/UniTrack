const paths = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3z",
  catalogue: "M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0z",
  scan: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  equipment: "M3 7h18v13H3zM8 7V4h8v3M3 12h18m-11 0v3h4v-3",
  kit: "M4 4h16v16H4zM4 9h16m-10 4h4m-4 3h4",
  categories: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm8 13v-2a4 4 0 0 0-3-4m-2-11a4 4 0 0 1 0 8",
  lab: "M9 3v7L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-5-9V3M8 3h8M7 15h10",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M18 6 6 18",
  arrow: "M4 12h15m-6-6 6 6-6 6",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="outline-icon">
      <path d={paths[name]} />
    </svg>
  );
}
