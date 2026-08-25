import Image from "next/image";

interface PlayerPhotoProps {
  photoUrl: string | null;
  alt: string;
  sizes: string;
  className?: string;
}

/**
 * A player's photo, or an honest placeholder when FPL hasn't got a
 * real one yet (`has_temporary_code` -- brand-new signings). Always
 * fills its positioned parent, same as a bare `<Image fill />` would,
 * so it drops into either the Hero card or the markets grid card
 * without extra layout work.
 */
export function PlayerPhoto({ photoUrl, alt, sizes, className = "" }: PlayerPhotoProps) {
  if (!photoUrl) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-accent-dim ${className}`}
        role="img"
        aria-label={alt}
      >
        <ShirtIcon />
      </div>
    );
  }

  return (
    <Image src={photoUrl} alt={alt} fill sizes={sizes} className={`object-cover ${className}`} unoptimized />
  );
}

function ShirtIcon() {
  return (
    <svg
      width="34%"
      height="34%"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-foreground/25"
    >
      <path
        d="M8 3L3 6.5 5 10l2-1.2V21h10V8.8l2 1.2 2-3.5L16 3l-1.5 2a3 3 0 0 1-5 0L8 3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
