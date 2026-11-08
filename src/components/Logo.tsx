import { useStore } from "../store";

/**
 * The TCI Boards mark (the same art as app-icon.svg, served from public/, so the icon and the
 * in-app logo can't drift apart). The original TCI Boards marks live on as the style Easter eggs.
 */
export function LogoMark({ size = 28, animate = false }: { size?: number; animate?: boolean }) {
  const style = useStore((s) => s.data.settings.style);
  if (style === "bassdrop") return <BassDropMark size={size} animate={animate} />;
  if (style === "partycat") return <PartyCatMark size={size} animate={animate} />;
  if (style === "undead") return <UndeadMark size={size} animate={animate} />;
  return <img src="/app-icon.svg" width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}

/** Bass Drop: same headphones, neon pink band, and an equalizer (cyan → pink) for columns. */
function BassDropMark({ size, animate }: { size: number; animate: boolean }) {
  return (
    <svg width={size} height={size} viewBox="48 48 928 928" aria-hidden="true" className={`bassdrop-mark ${animate ? "dancing" : ""}`}>
      <defs>
        <linearGradient id="bd-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a1650" />
          <stop offset="1" stopColor="#0f0a1e" />
        </linearGradient>
        <linearGradient id="bd-eq" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#22e1ff" />
          <stop offset="1" stopColor="#ff3fa4" />
        </linearGradient>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="208" fill="url(#bd-bg)" />
      {/* sound waves off the ear cups */}
      <g fill="none" stroke="#22e1ff" strokeWidth="18" strokeLinecap="round" opacity=".85" className="bd-waves">
        <path d="M 112 560 Q 86 632 112 704" />
        <path d="M 912 560 Q 938 632 912 704" />
      </g>
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#0a0614" strokeWidth="64" strokeLinecap="round" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#ff3fa4" strokeWidth="30" strokeLinecap="round" />
      <rect x="196" y="500" width="84" height="264" rx="30" fill="#ff3fa4" />
      <rect x="150" y="522" width="86" height="220" rx="30" fill="#0a0614" />
      <rect x="744" y="500" width="84" height="264" rx="30" fill="#ff3fa4" />
      <rect x="788" y="522" width="86" height="220" rx="30" fill="#0a0614" />
      {/* five equalizer bars instead of three columns */}
      <g fill="url(#bd-eq)" className="bd-bars">
        <rect x="324" y="470" width="62" height="294" rx="24" />
        <rect x="402" y="380" width="62" height="384" rx="24" />
        <rect x="480" y="540" width="62" height="224" rx="24" />
        <rect x="558" y="430" width="62" height="334" rx="24" />
        <rect x="636" y="600" width="62" height="164" rx="24" />
      </g>
    </svg>
  );
}

/**
 * Party Cat: the classic TCI Boards mark, quietly a cat: tabby ears on the headband and a tail curling
 * out of an ear cup, in the Disco ball colors. It spins like the meme.
 */
function PartyCatMark({ size, animate }: { size: number; animate: boolean }) {
  return (
    <svg width={size} height={size} viewBox="48 48 928 928" aria-hidden="true" className={`partycat-mark ${animate ? "spinning" : ""}`}>
      <defs>
        <linearGradient id="pc-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14263d" />
          <stop offset="1" stopColor="#0a1220" />
        </linearGradient>
        <linearGradient id="pc-bars" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8ff3ee" />
          <stop offset=".5" stopColor="#3dd6d0" />
          <stop offset="1" stopColor="#1fa7a2" />
        </linearGradient>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="208" fill="url(#pc-bg)" />
      {/* disco sparkles */}
      <g fill="#eaf8ff">
        <path d="M 170 200 l 10 26 l 26 10 l -26 10 l -10 26 l -10 -26 l -26 -10 l 26 -10 z" opacity=".9" />
        <path d="M 850 180 l 7 18 l 18 7 l -18 7 l -7 18 l -7 -18 l -18 -7 l 18 -7 z" opacity=".75" />
        <circle cx="880" cy="320" r="8" opacity=".6" />
        <circle cx="140" cy="380" r="7" opacity=".5" />
      </g>
      {/* tabby ears */}
      <path d="M 268 420 Q 236 288 262 196 Q 352 246 414 318 Z" fill="#8a847b" stroke="#0a0c10" strokeWidth="16" strokeLinejoin="round" />
      <path d="M 284 378 Q 266 300 280 244 Q 334 280 372 322 Z" fill="#f2a7c3" />
      <path d="M 756 420 Q 788 288 762 196 Q 672 246 610 318 Z" fill="#8a847b" stroke="#0a0c10" strokeWidth="16" strokeLinejoin="round" />
      <path d="M 740 378 Q 758 300 744 244 Q 690 280 652 322 Z" fill="#f2a7c3" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#0a0c10" strokeWidth="64" strokeLinecap="round" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#ff5e7e" strokeWidth="30" strokeLinecap="round" />
      <rect x="196" y="500" width="84" height="264" rx="30" fill="#ff5e7e" />
      <rect x="150" y="522" width="86" height="220" rx="30" fill="#0a0c10" />
      <rect x="744" y="500" width="84" height="264" rx="30" fill="#ff5e7e" />
      <rect x="788" y="522" width="86" height="220" rx="30" fill="#0a0c10" />
      <rect x="334" y="400" width="96" height="364" rx="30" fill="url(#pc-bars)" />
      <rect x="464" y="500" width="96" height="264" rx="30" fill="url(#pc-bars)" opacity=".88" />
      <rect x="594" y="590" width="96" height="174" rx="30" fill="url(#pc-bars)" opacity=".76" />
      {/* tail curling up out of the right ear cup */}
      <path d="M 830 752 C 912 752 936 668 900 604 C 880 566 896 520 936 528" fill="none" stroke="#0a0c10" strokeWidth="56" strokeLinecap="round" />
      <path d="M 830 752 C 912 752 936 668 900 604 C 880 566 896 520 936 528" fill="none" stroke="#8a847b" strokeWidth="34" strokeLinecap="round" />
      <path d="M 884 734 L 896 712 M 910 676 L 888 664 M 888 618 L 910 600" stroke="#5c574f" strokeWidth="11" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Undead: the headphones in slime green over a graveyard at night: the columns are tombstones, and a
 * zombie hand claws up out of the ground in the middle. The hand rises on hover.
 */
function UndeadMark({ size, animate }: { size: number; animate: boolean }) {
  const stone = (x: number, y: number) => `M ${x} 764 V ${y + 48} A 48 48 0 0 1 ${x + 96} ${y + 48} V 764 Z`;
  return (
    <svg width={size} height={size} viewBox="48 48 928 928" aria-hidden="true" className={`undead-mark ${animate ? "rising" : ""}`}>
      <defs>
        <linearGradient id="ud-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2a20" />
          <stop offset="1" stopColor="#0a110c" />
        </linearGradient>
        <linearGradient id="ud-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a7ae9c" />
          <stop offset="1" stopColor="#6b7366" />
        </linearGradient>
        <clipPath id="ud-ground">
          <rect x="48" y="48" width="928" height="716" />
        </clipPath>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="208" fill="url(#ud-bg)" />
      {/* full moon */}
      <circle cx="786" cy="226" r="92" fill="#e8e4c9" opacity=".9" />
      <circle cx="756" cy="204" r="16" fill="#cfcab0" opacity=".7" />
      <circle cx="812" cy="262" r="11" fill="#cfcab0" opacity=".6" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#050806" strokeWidth="64" strokeLinecap="round" />
      <path d="M 214 600 A 298 298 0 0 1 810 600" fill="none" stroke="#8fd14f" strokeWidth="30" strokeLinecap="round" />
      <rect x="196" y="500" width="84" height="264" rx="30" fill="#8fd14f" />
      <rect x="150" y="522" width="86" height="220" rx="30" fill="#050806" />
      <rect x="744" y="500" width="84" height="264" rx="30" fill="#8fd14f" />
      <rect x="788" y="522" width="86" height="220" rx="30" fill="#050806" />
      {/* tombstones for columns */}
      <path d={stone(334, 440)} fill="url(#ud-stone)" />
      <path d="M 382 520 V 600 M 356 552 H 408" stroke="#4b5246" strokeWidth="14" strokeLinecap="round" />
      <path d={stone(594, 590)} fill="url(#ud-stone)" opacity=".85" />
      {/* the hand, clawing up from the ground: drawn twice, dark then green, so it has one outline */}
      <g clipPath="url(#ud-ground)">
        <g className="ud-hand">
          {(["#050806", "#8fbf6a"] as const).map((color, i) => (
            <g key={color} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
              <path d="M 515 800 V 640" strokeWidth={56 + (1 - i) * 24} />
              <path d="M 515 628 V 588" strokeWidth={82 + (1 - i) * 24} />
              <path d="M 485 576 L 474 522 L 484 492" strokeWidth={22 + (1 - i) * 24} />
              <path d="M 507 570 L 504 506 L 513 468" strokeWidth={22 + (1 - i) * 24} />
              <path d="M 529 572 L 536 514 L 548 486" strokeWidth={22 + (1 - i) * 24} />
              <path d="M 548 592 L 563 550 L 577 532" strokeWidth={19 + (1 - i) * 24} />
              <path d="M 482 626 L 452 600 L 446 572" strokeWidth={26 + (1 - i) * 24} />
            </g>
          ))}
          {/* knuckles and a torn sleeve */}
          <path d="M 490 596 Q 497 590 504 596 M 512 594 Q 519 588 526 594 M 533 598 Q 540 592 547 598" fill="none" stroke="#5f8a45" strokeWidth="6" strokeLinecap="round" />
          <path d="M 472 690 H 558 L 562 742 L 546 728 L 532 746 L 516 730 L 500 748 L 486 730 L 468 744 Z" fill="#4b4560" stroke="#050806" strokeWidth="12" strokeLinejoin="round" />
        </g>
      </g>
      {/* fresh earth */}
      <path d="M 300 772 Q 512 712 724 772 Z" fill="#2c3a25" />
    </svg>
  );
}

export function Wordmark() {
  const style = useStore((s) => s.data.settings.style);
  // Undead: the last "o" is a full moon.
  if (style === "undead")
    return (
      <span className="wordmark" aria-label="TCI Boards">
        <span aria-hidden="true">Zom</span>
        <span aria-hidden="true">
          ell
          <svg className="moon-o" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="#e8e4c9" />
            <circle cx="8.5" cy="9" r="2.4" fill="#cfcab0" />
            <circle cx="15" cy="14.5" r="1.7" fill="#cfcab0" />
            <circle cx="10" cy="16" r="1.1" fill="#cfcab0" />
          </svg>
        </span>
        {/* a bat that flaps past the moon on hover */}
        <span className="bat" aria-hidden="true">
          <svg viewBox="0 0 32 14">
            <path d="M16 4.6 L15 2 L14.4 4.3 C11.5 1.6 6 .8 0 3.6 C2.8 4.6 3.9 6.6 4 8.8 C5.8 7.2 8 7.6 9 9.6 C10 8 12 8 13 9.8 C14 8.8 15 9 16 11 C17 9 18 8.8 19 9.8 C20 8 22 8 23 9.6 C24 7.6 26.2 7.2 28 8.8 C28.1 6.6 29.2 4.6 32 3.6 C26 .8 20.5 1.6 17.6 4.3 L17 2 Z" />
          </svg>
        </span>
      </span>
    );
  return (
    <span className="wordmark">
      TCI&nbsp;<span>Boards</span>
    </span>
  );
}
