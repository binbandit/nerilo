/** Crisp, scalable interpretations of the moodboard's rounded wordmark and arch. */
export function NeriloWordmark() {
  return (
    <svg
      className="nerilo-wordmark"
      viewBox="0 0 240 66"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0 64V42C0 12 44 12 44 42V64H29V42C29 30 15 30 15 42V64Z" />
      <path
        fillRule="evenodd"
        d="M97 47H65C68 55 76 56 83 51L94 59C78 73 49 65 49 43C49 12 98 12 98 43L97 47ZM65 37H82C80 27 68 27 65 37Z"
      />
      <path d="M104 64V42C104 27 114 20 129 20H136V35H130C123 35 119 38 119 45V64Z" />
      <circle cx="149" cy="9" r="8" />
      <path d="M141 21H157V64H141ZM165 2H180V45C180 50 182 51 188 51V64C172 64 165 58 165 44Z" />
      <path
        fillRule="evenodd"
        d="M216 19C248 19 248 66 216 66C184 66 184 19 216 19ZM216 34C204 34 204 51 216 51C228 51 228 34 216 34Z"
      />
    </svg>
  );
}

export function NeriloMark() {
  return (
    <svg
      className="nerilo-mark"
      viewBox="0 0 64 64"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 60V33C4-3 60-3 60 33V60H42V33C42 20 22 20 22 33V60Z" />
    </svg>
  );
}
