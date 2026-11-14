// Small inline illustrations for empty and error states. Flat shapes in the brand colors, decorative only.

const stroke = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

export type ArtName = "list" | "market" | "rescue" | "wallet" | "activity" | "closed";

export function Art({ name }: { name: ArtName }) {
  return (
    <svg viewBox="0 0 112 84" aria-hidden="true" focusable="false">
      <ellipse cx="56" cy="76" rx="38" ry="5" fill="rgba(110,128,168,.18)" />
      {name === "list" && (
        <>
          <rect x="22" y="22" width="68" height="44" rx="10" fill="#fff" stroke="#c9d3ee" strokeWidth="2" />
          <rect x="30" y="14" width="68" height="44" rx="10" fill="#eef2fe" stroke="#b5c3ec" strokeWidth="2" />
          <path d="M42 30h30M42 40h20" stroke="#3a58d6" strokeWidth="3" fill="none" {...stroke} />
          <circle cx="86" cy="34" r="5" fill="#3a58d6" />
        </>
      )}
      {name === "market" && (
        <>
          <path d="M26 34l5-14h50l5 14" fill="#eef2fe" stroke="#b5c3ec" strokeWidth="2" {...stroke} />
          <path d="M26 34c0 5 4 8 8.5 8S43 39 43 34c0 5 4 8 8.5 8S60 39 60 34c0 5 4 8 8.5 8S77 39 77 34c0 5 4 8 9 8" stroke="#3a58d6" strokeWidth="2.5" fill="none" {...stroke} />
          <rect x="30" y="42" width="52" height="26" rx="4" fill="#fff" stroke="#c9d3ee" strokeWidth="2" />
          <rect x="48" y="50" width="16" height="18" rx="3" fill="#dfe6fb" />
        </>
      )}
      {name === "rescue" && (
        <>
          <path d="M56 12l28 10v20c0 16-11 26-28 31C39 68 28 58 28 42V22z" fill="#eef2fe" stroke="#b5c3ec" strokeWidth="2" {...stroke} />
          <path d="M44 42l9 9 16-18" stroke="#1f9d6b" strokeWidth="4" fill="none" {...stroke} />
        </>
      )}
      {name === "wallet" && (
        <>
          <rect x="22" y="24" width="68" height="44" rx="10" fill="#fff" stroke="#b5c3ec" strokeWidth="2" />
          <path d="M22 36h68" stroke="#c9d3ee" strokeWidth="2" />
          <rect x="66" y="44" width="26" height="14" rx="7" fill="#3a58d6" />
          <circle cx="74" cy="51" r="2.6" fill="#fff" />
        </>
      )}
      {name === "activity" && (
        <>
          <rect x="22" y="16" width="68" height="52" rx="10" fill="#fff" stroke="#c9d3ee" strokeWidth="2" />
          <path d="M32 46h12l6-16 8 28 6-12h8" stroke="#3a58d6" strokeWidth="3" fill="none" {...stroke} />
        </>
      )}
      {name === "closed" && (
        <>
          <rect x="30" y="26" width="52" height="40" rx="8" fill="#fff" stroke="#c9d3ee" strokeWidth="2" />
          <path d="M42 26v-6a14 14 0 0 1 28 0v6" stroke="#b5c3ec" strokeWidth="3" fill="none" {...stroke} />
          <circle cx="56" cy="46" r="5" fill="#3a58d6" />
        </>
      )}
    </svg>
  );
}

/** Small warning mark for error boxes. */
export function ErrorArt() {
  return (
    <svg viewBox="0 0 56 56" aria-hidden="true" focusable="false">
      <circle cx="28" cy="28" r="26" fill="rgba(214,69,69,.14)" />
      <path d="M28 14l15 26H13z" fill="#fff" stroke="#c43a3a" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M28 24v8" stroke="#c43a3a" strokeWidth="3" strokeLinecap="round" />
      <circle cx="28" cy="36" r="1.8" fill="#c43a3a" />
    </svg>
  );
}
