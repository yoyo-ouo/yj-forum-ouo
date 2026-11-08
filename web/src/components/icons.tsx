import React from "react";

export type IconName =
  | "back" | "forward" | "down" | "up"
  | "search" | "home" | "bell" | "user" | "globe" | "grid"
  | "plus" | "more" | "share" | "heart" | "like" | "bookmark" | "comment"
  | "close" | "settings" | "refresh" | "image" | "bold" | "italic" | "underline"
  | "link" | "list" | "ordered" | "quote" | "code" | "smile" | "check"
  | "edit" | "eye" | "clock" | "send" | "trash" | "mail" | "shield"
  | "moon" | "sun" | "sparkle" | "download" | "info" | "logout" | "pin" | "compass";

const D: Record<IconName, React.ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  forward: <path d="M9 5l7 7-7 7" />,
  down: <path d="M5 9l7 7 7-7" />,
  up: <path d="M5 15l7-7 7 7" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></>,
  home: <><path d="M4 10.6L12 4l8 6.6V19a1.6 1.6 0 0 1-1.6 1.6h-3.6v-6H9.2v6H5.6A1.6 1.6 0 0 1 4 19z" /></>,
  bell: <><path d="M18 16.4V11a6 6 0 1 0-12 0v5.4L4 19.2h16z" /><path d="M10 22h4" /></>,
  user: <><circle cx="12" cy="8" r="3.6" /><path d="M5 20c1.2-3.6 3.9-5.4 7-5.4s5.8 1.8 7 5.4" /></>,
  globe: <><circle cx="12" cy="12" r="8.6" /><path d="M3.6 12h16.8M12 3.4c2.8 3.4 2.8 13.8 0 17.2M12 3.4c-2.8 3.4-2.8 13.8 0 17.2" /></>,
  grid: <><rect x="3.4" y="4.4" width="17.2" height="15.2" rx="3.6" /><path d="M6.9 9.3h6.4M6.9 12.3h10.2M6.9 15.3h7.8" /></>,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  more: <><circle cx="5.5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="18.5" cy="12" r="1.5" /></>,
  share: <><path d="M12 15.5V3.8M8 7.6l4-3.8 4 3.8" /><path d="M5 13.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-5.5" /></>,
  heart: <path d="M12 20.2S4.6 15.7 4.6 10.6A4.1 4.1 0 0 1 12 7.9a4.1 4.1 0 0 1 7.4 2.7c0 5.1-7.4 9.6-7.4 9.6z" />,
  like: <><path d="M7.4 20.4V9.6l3.7-5.2 1.2 1v4.4h5.6a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7z" /><path d="M7.4 20.4H4.2V9.6h3.2" /></>,
  bookmark: <path d="M6.8 4.4h10.4a1 1 0 0 1 1 1v14.2l-6.2-4.2-6.2 4.2V5.4a1 1 0 0 1 1-1z" />,
  comment: <path d="M20 11.6a7.9 7.9 0 0 1-7.9 7.9H8.3L4.2 21.5l1.4-4.3A7.9 7.9 0 1 1 20 11.6z" />,
  close: <path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6" />,
  settings: <><path d="M4 7h7.6M18 7h2M4 12h2M10.4 12H20M4 17h9.6M19.6 17H20" /><circle cx="15.6" cy="7" r="2.4" /><circle cx="8.4" cy="12" r="2.4" /><circle cx="17.6" cy="17" r="2.4" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4.2v4h-4" /></>,
  image: <><rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.6" /><circle cx="8.6" cy="9.6" r="1.5" /><path d="M20.6 15.4l-4.8-4.8-8.4 9" /></>,
  bold: <><path d="M7.4 5h4.9a3.4 3.4 0 0 1 0 6.8H7.4z" /><path d="M7.4 11.8h5.6a3.6 3.6 0 0 1 0 7.2H7.4z" /></>,
  italic: <path d="M10.4 5h7M6.6 19h7M14.4 5l-4.8 14" />,
  underline: <><path d="M7 4.4v6.8a5 5 0 0 0 10 0V4.4" /><path d="M5 20h14" /></>,
  link: <><path d="M10.4 13.6a4.2 4.2 0 0 0 5.9 0l2.3-2.3a4.2 4.2 0 1 0-5.9-5.9L11.6 6.5" /><path d="M13.6 10.4a4.2 4.2 0 0 0-5.9 0l-2.3 2.3a4.2 4.2 0 1 0 5.9 5.9l1.1-1.1" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.6" cy="6" r="1.2" /><circle cx="4.6" cy="12" r="1.2" /><circle cx="4.6" cy="18" r="1.2" /></>,
  ordered: <><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5.4l1.4-.8V9" /><path d="M3.8 14.2c0-1 .8-1.6 1.7-1.6s1.6.6 1.6 1.5c0 1.6-3.3 2.2-3.3 3.8h3.4" /></>,
  quote: <><path d="M9.4 6.4C6.6 7.6 5 10 5 13.2c0 2.6 1.3 4.4 3.3 4.4 1.7 0 2.9-1.2 2.9-2.9 0-1.6-1.1-2.7-2.6-2.7-.3 0-.5 0-.7.1.3-1.4 1.3-2.6 2.8-3.4z" /><path d="M18.6 6.4c-2.8 1.2-4.4 3.6-4.4 6.8 0 2.6 1.3 4.4 3.3 4.4 1.7 0 2.9-1.2 2.9-2.9 0-1.6-1.1-2.7-2.6-2.7-.3 0-.5 0-.7.1.3-1.4 1.3-2.6 2.8-3.4z" /></>,
  code: <path d="M9 7.6L4.4 12 9 16.4M15 7.6L19.6 12 15 16.4" />,
  smile: <><circle cx="12" cy="12" r="8.6" /><path d="M8.4 14.2c.9 1.4 2 2.1 3.6 2.1s2.7-.7 3.6-2.1" /><circle cx="9.2" cy="9.8" r="0.9" /><circle cx="14.8" cy="9.8" r="0.9" /></>,
  check: <path d="M5 12.6l4.6 4.6L19 6.8" />,
  edit: <><path d="M4.4 19.6l.6-4L15.4 5.2a1.6 1.6 0 0 1 2.3 0l1.1 1.1a1.6 1.6 0 0 1 0 2.3L8.4 19z" /><path d="M14.4 6.4l3.2 3.2" /></>,
  eye: <><path d="M2.8 12S6.2 6.2 12 6.2 21.2 12 21.2 12 17.8 17.8 12 17.8 2.8 12 2.8 12z" /><circle cx="12" cy="12" r="2.7" /></>,
  clock: <><circle cx="12" cy="12" r="8.6" /><path d="M12 7.2V12l3.2 1.9" /></>,
  send: <path d="M20.4 3.6L3.6 10.4l6.2 2.6 2.6 6.2z" />,
  trash: <><path d="M4.8 7h14.4M9.2 7V4.8h5.6V7" /><path d="M6.8 7l.9 12.4h8.6L17.2 7" /></>,
  mail: <><rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.4" /><path d="M3.8 7l8.2 5.8L20.2 7" /></>,
  shield: <><path d="M12 3.4l7 2.8v4.6c0 4.4-2.9 7.9-7 9.8-4.1-1.9-7-5.4-7-9.8V6.2z" /><path d="M9 12l2.2 2.2L15.4 10" /></>,
  moon: <path d="M20 14.6A8.6 8.6 0 0 1 9.4 4 8.6 8.6 0 1 0 20 14.6z" />,
  sun: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.8v2.2M12 19v2.2M4.5 12H2.3M21.7 12h-2.2M6.2 6.2L4.6 4.6M19.4 19.4l-1.6-1.6M17.8 6.2l1.6-1.6M4.6 19.4l1.6-1.6" /></>,
  sparkle: <><path d="M12 3.4l1.9 4.9 4.9 1.9-4.9 1.9L12 17l-1.9-4.9L5.2 10.2l4.9-1.9z" /><path d="M18.4 16.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>,
  download: <><path d="M12 3.8v10.4M8 10.6l4 4 4-4" /><path d="M4.8 19.4h14.4" /></>,
  info: <><circle cx="12" cy="12" r="8.6" /><path d="M12 11v5.4" /><circle cx="12" cy="7.9" r="0.9" /></>,
  logout: <><path d="M14.4 4.4h3.8a1.4 1.4 0 0 1 1.4 1.4v12.4a1.4 1.4 0 0 1-1.4 1.4h-3.8" /><path d="M10 8l-4 4 4 4M6 12h9" /></>,
  pin: <><path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10z" /><circle cx="12" cy="11" r="2.2" /></>,
  compass: <><circle cx="12" cy="12" r="8.6" /><path d="M14.9 9.1l-1.6 4.2-4.2 1.6 1.6-4.2z" /></>,
};

export function Icon({ name, size = 22, className, strokeWidth = 1.8 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {D[name]}
    </svg>
  );
}
