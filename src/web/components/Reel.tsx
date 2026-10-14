type Props = {
  className?: string;
  /** Намотка ленты от 0 до 1: чем больше библиотека, тем толще рулон. */
  pack?: number;
};

const HUB = 8;
const MAX = 21;

/** Катушка кассеты: рулон ленты вокруг втулки; вращается, только пока идёт работа с этой декой. */
export function Reel({ className = "reel", pack }: Props) {
  const outer = pack === undefined ? 0 : HUB + Math.min(1, Math.max(0, pack)) * (MAX - HUB);
  const width = outer - HUB;
  return (
    <svg className={className} viewBox="0 0 44 44" aria-hidden="true">
      {width > 0.5 && (
        <circle className="reel-pack" cx="22" cy="22" r={HUB + width / 2} strokeWidth={width} fill="none" />
      )}
      <circle cx="22" cy="22" r={HUB} fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M22 14v4M22 26v4M15 18l3.5 2M25.5 24l3.5 2M15 26l3.5-2M25.5 20l3.5-2"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="22" cy="22" r="21" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}
