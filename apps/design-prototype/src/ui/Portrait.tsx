// Original, stylized clinical-photo placeholders (no real patient imagery).
// Views follow the Bible 6.2 face protocol; `lipFullness` lets the same view
// render a "before", an "after" or an AI visualization for comparison scenes.
import React from "react";

export type FaceView = "FRONT" | "LEFT_45" | "RIGHT_45" | "LEFT_PROFILE" | "RIGHT_PROFILE";

type Props = {
  view: FaceView;
  lipFullness?: number | undefined;
  skin?: string | undefined;
  hair?: string | undefined;
  backdrop?: "studio" | "light" | "none" | undefined;
  className?: string | undefined;
  label?: string | undefined;
  /** cover crops to fill (thumbnails); contain shows the whole photo (viewers). */
  fit?: "cover" | "contain" | undefined;
};

let uid = 0;

export function Portrait({
  view,
  lipFullness = 0,
  skin = "#C79A7E",
  hair = "#3B2A22",
  backdrop = "studio",
  className,
  label,
  fit = "cover",
}: Props) {
  const id = React.useMemo(() => `pt${++uid}`, []);
  const bgTop = backdrop === "studio" ? "#50555D" : "#E4E1DB";
  const bgBottom = backdrop === "studio" ? "#2B2E33" : "#C9C5BD";
  const profile = view === "LEFT_PROFILE" || view === "RIGHT_PROFILE";
  const mirror = view === "LEFT_PROFILE" || view === "LEFT_45";
  const shade = "#A77C63";
  const lip = "#A95E5A";

  return (
    <svg
      className={className ? `portrait ${className}` : "portrait"}
      viewBox="0 0 300 400"
      preserveAspectRatio={fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
      role="img"
      aria-label={label ?? `Clinical photo placeholder, ${view.toLowerCase().replace("_", " ")} view`}
    >
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={bgTop} />
          <stop offset="1" stopColor={bgBottom} />
        </linearGradient>
        <radialGradient id={`${id}sk`} cx="0.45" cy="0.4" r="0.7">
          <stop offset="0" stopColor={skin} />
          <stop offset="1" stopColor={shade} />
        </radialGradient>
      </defs>
      {backdrop === "none" ? null : <rect width="300" height="400" fill={`url(#${id}bg)`} />}
      <g transform={mirror ? "translate(300 0) scale(-1 1)" : undefined}>
        {profile ? <ProfileHead id={id} hair={hair} lip={lip} f={lipFullness} /> : null}
        {!profile ? (
          <FrontHead id={id} hair={hair} lip={lip} f={lipFullness} yaw={view === "FRONT" ? 0 : 1} />
        ) : null}
      </g>
    </svg>
  );
}

function Shoulders({ fill }: { fill: string }) {
  return <path d="M28 400C48 334 104 312 150 308c46 4 102 26 122 92Z" fill={fill} />;
}

function FrontHead({
  id,
  hair,
  lip,
  f,
  yaw,
}: {
  id: string;
  hair: string;
  lip: string;
  f: number;
  yaw: number;
}) {
  // yaw 1 = turned about 45°: features shift toward the far side, far eye narrows.
  const dx = yaw * 20;
  const lipUp = 206 - f * 1.6;
  const lipDown = 224 + f * 2.4;
  return (
    <g>
      <path d="M86 150c-9 55-6 110 8 150h26c-12-40-14-92-8-140Z" fill={hair} />
      <path d="M214 150c9 55 6 110-8 150h-26c12-40 14-92 8-140Z" fill={hair} />
      <Shoulders fill="#1D2024" />
      <path d="M126 246h48l4 70h-56Z" fill="#B68A70" />
      <ellipse cx={150 + dx * 0.25} cy="172" rx={62 - yaw * 6} ry="80" fill={`url(#${id}sk)`} />
      <ellipse cx={88 + dx * 0.9} cy="178" rx="8" ry="15" fill="#B98C71" opacity={yaw ? 0 : 1} />
      <ellipse cx={212 + dx * 0.1} cy="178" rx="8" ry="15" fill="#B98C71" />
      <path
        d={`M${88 + dx * 0.4} 165c-3-70 30-96 62-96 36 0 66 26 62 96-8-34-26-56-62-56-34 0-54 22-62 56Z`}
        fill={hair}
      />
      <g fill="none" stroke="#3A2A24" strokeWidth="2.6" strokeLinecap="round">
        <path d={`M${112 + dx} 140q13-8 26-2`} opacity={yaw ? 0.85 : 1} />
        <path d={`M${162 + dx} 138q13-6 26 2`} />
      </g>
      <g>
        <path
          d={`M${115 + dx + yaw * 4} 155q${11 - yaw * 3} -8 ${22 - yaw * 6} 0q-${11 - yaw * 3} 6 -${22 - yaw * 6} 0Z`}
          fill="#F4EEE8"
        />
        <circle cx={126 + dx + yaw * 1} cy="155" r="4.2" fill="#3B2E28" />
        <path d={`M${163 + dx} 155q11-8 22 0q-11 6-22 0Z`} fill="#F4EEE8" />
        <circle cx={174 + dx} cy="155" r="4.2" fill="#3B2E28" />
      </g>
      <path
        d={`M${150 + dx} 158q${-4 + yaw * 6} 27 ${-8 + yaw * 10} 34q8 5 16 0`}
        fill="none"
        stroke="#946A55"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d={`M${130 + dx} 212q10 ${lipUp - 212} 20 -3q10 ${lipUp - 209} 20 3q-20 4 -40 0Z`} fill={lip} />
      <path d={`M${130 + dx} 212q20 ${lipDown - 212} 40 0q-20 5 -40 0Z`} fill={lip} opacity="0.92" />
      <path d={`M${131 + dx} 212.5q19 3 38 0`} stroke="#7E3F3D" strokeWidth="1.4" fill="none" />
    </g>
  );
}

function ProfileHead({ id, hair, lip, f }: { id: string; hair: string; lip: string; f: number }) {
  const l = f * 1.8;
  return (
    <g>
      <path d="M104 150c-18 50-16 110-6 150h30c-6-40-8-92-4-140Z" fill={hair} />
      <Shoulders fill="#1D2024" />
      <path d="M126 236l40 6 2 74h-46Z" fill="#B68A70" />
      <path
        d={`M100 124c0-44 40-62 76-54 30 7 40 38 38 70l1 10c7 11 12 22 17 30 4 6 7 12 1 16-6 3-10 3-12 7 2 3 ${
          5 + l
        } 5 ${4 + l} 9-3 3-2 5 ${-1 + l} 8 2 6-5 10-7 14 0 10-6 18-18 20-16 2-28 0-36 9l2 48-40 0-2-72c-18-15-26-40-24-70 1-20 6-35 6-45Z`}
        fill={`url(#${id}sk)`}
      />
      <path
        d={`M${219 + l * 0.5} 205c${3 + l} 2 ${5 + l} 5 ${4 + l} 9-3 3-2 5 ${-1 + l} 8`}
        fill="none"
        stroke={lip}
        strokeWidth={4 + f * 0.6}
        strokeLinecap="round"
      />
      <ellipse cx="146" cy="176" rx="9" ry="15" fill="#B98C71" />
      <path d="M100 150c-6-60 30-86 70-82 32 4 46 30 44 58-10-24-30-36-58-34-26 2-44 22-56 58Z" fill={hair} />
      <path d="M186 142q12-5 22 0" stroke="#3A2A24" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M194 154q7-5 13 0q-7 4-13 0Z" fill="#F4EEE8" />
      <circle cx="202" cy="154" r="3" fill="#3B2E28" />
    </g>
  );
}
