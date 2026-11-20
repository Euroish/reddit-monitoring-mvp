const SIGNAL_FOLD_PATH =
  'M11 70Q10 64 16 60L35 49Q40 46 38 53L30 83Q29 87 23 88L6 89Z M33 83L46 42Q49 34 57 30L73 22Q79 19 77 27L65 65Q63 73 56 76Z M68 72L81 25Q83 17 75 18L62 18Q65 10 73 7L90 2Q97 0 95 9L83 54Q81 65 75 68Z';

export function SiftlineLogo({
  size = 24,
  showWordmark = true,
  fontSize = 18,
  subLabel,
}: {
  size?: number;
  showWordmark?: boolean;
  fontSize?: number;
  subLabel?: string;
}) {
  return (
    <span className="sift-lockup" style={{ fontSize }}>
      <svg className="sift-mark" viewBox="0 0 100 100" style={{ width: size, height: size }} aria-hidden="true">
        <path d={SIGNAL_FOLD_PATH} />
      </svg>
      {showWordmark && (
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1 }}>
          <span>SIFTLINE</span>
          {subLabel && (
            <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0', opacity: 0.72, marginTop: 2 }}>
              {subLabel}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export const BrandMark = SiftlineLogo;
