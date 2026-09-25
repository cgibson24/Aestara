// Original line icons (24px grid, 1.75 stroke). Stand-ins for SF Symbols in the
// web prototype; the iOS apps use SF Symbols directly.
import React from "react";

const paths = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.2-4.2",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5",
  people:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 8.5c0-3 2.7-5 6-5s6 2 6 5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.6c2 .6 3.3 2.3 3.3 4.9",
  camera:
    "M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  photo:
    "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Zm0 9 4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01",
  compare: "M12 3v18M5 6h4v12H5zM15 6h4v12h-4z",
  sparkles:
    "M12 3.5l1.6 4.3 4.4 1.7-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.7L12 3.5ZM18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z",
  doc: "M7 3.5h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Zm7 0v4h4M9 12h6M9 15.5h6",
  signature: "M4 17c2-4 3.5-8 5-8s-.5 8 1.5 8 2.5-5 4-5 1 3 2.5 3 2-1 3-2M4 20.5h16",
  message:
    "M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5A1.5 1.5 0 0 1 3.5 15.5V7A1.5 1.5 0 0 1 5 5.5Z",
  calendar:
    "M5.5 5.5h13A1.5 1.5 0 0 1 20 7v11.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5ZM4 10h16M8.5 3.5v4M15.5 3.5v4",
  video:
    "M4.5 7h10A1.5 1.5 0 0 1 16 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 15.5v-7A1.5 1.5 0 0 1 4.5 7Zm11.5 3.5 5-3v9l-5-3",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  shield: "M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6l-7-2.5Zm-3 8.5 2.2 2.2L15.5 10",
  chevronRight: "m9.5 5.5 6.5 6.5-6.5 6.5",
  chevronLeft: "m14.5 5.5-6.5 6.5 6.5 6.5",
  chevronDown: "m5.5 9.5 6.5 6.5 6.5-6.5",
  plus: "M12 5v14M5 12h14",
  check: "m5 12.5 4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6 6 18",
  wifiOff:
    "M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.3-2.4M12 20h.01M14.8 10.7A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4.6-2.9M10.7 6.1A15 15 0 0 1 22 9.5",
  lock: "M7 10.5V8a5 5 0 0 1 10 0v2.5M5.5 10.5h13v9.5h-13zM12 14v2.5",
  clock: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 7.5V12l3 2",
  grid: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  faceId:
    "M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5M9 9.5v1.5M15 9.5v1.5M12 9.5v3.5h-1M9.5 16a3.8 3.8 0 0 0 5 0",
  send: "M4 12 20 4l-6 16-2.5-6.5L4 12Zm7.5 1.5L20 4",
  paperclip: "m16.5 7.5-7 7a2 2 0 0 0 2.8 2.8l7.4-7.4a4 4 0 0 0-5.6-5.6l-7.4 7.4a6 6 0 0 0 8.5 8.5l6-6",
  warning: "M12 4 2.8 19.5h18.4L12 4Zm0 6v4.5M12 17.2h.01",
  info: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 11v5.5M12 7.8h.01",
  home: "M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z",
  heart: "M12 19.5s-7.5-4.4-7.5-9.7A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7c0 5.3-7.5 9.7-7.5 9.7Z",
  clipboard:
    "M9 4.5h6v2.5H9zM8 5.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-13a1 1 0 0 0-1-1H16M8.5 12l2 2 4-4",
  flip: "M12 4v16M8 8 4 12l4 4M16 8l4 4-4 4",
  layers: "m12 4 8.5 4.5L12 13 3.5 8.5 12 4Zm-8.5 8L12 16.5l8.5-4.5M3.5 15.5 12 20l8.5-4.5",
  refresh: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15",
  export: "M12 15V4m0 0L8 8m4-4 4 4M5 13.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5.5",
  sliders: "M5 7h9M18 7h1M5 17h3M12 17h7M16 5v4M10 15v4",
  eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  building:
    "M5 20.5V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15.5M15 9.5h3a1 1 0 0 1 1 1v10M3.5 20.5h17M8.5 8h3M8.5 11.5h3M8.5 15h3",
  list: "M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  pencil: "M15.5 5.5l3 3L8 19H5v-3L15.5 5.5Z",
  logout: "M14 4.5h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10",
  stethoscope:
    "M6 3.5v5a4 4 0 0 0 8 0v-5M10 12.5V15a4.5 4.5 0 0 0 9 0v-1.5M19 13.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z",
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 20,
  title,
  className,
}: {
  name: IconName;
  size?: number;
  title?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={paths[name]} />
    </svg>
  );
}
