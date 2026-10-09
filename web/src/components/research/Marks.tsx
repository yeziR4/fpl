import { labMeta } from "@/lib/study";

/**
 * Small identity marks: a lab badge for an agent, an avatar for a person.
 *
 * The lab badge is a monogram in the vendor's brand colour, not their real logo.
 * Using the actual marks on a public page implies an association with OpenAI,
 * Anthropic, Google, xAI or DeepSeek that does not exist, and this page is a
 * study rather than a partnership. A coloured monogram is honest, reads at 20px,
 * and can be swapped for the real asset the day someone asks permission.
 */

export function LabBadge({ slug, size = 22 }: { slug: string; size?: number }) {
  const { mark, color, lab } = labMeta(slug);
  return (
    <span
      title={lab}
      aria-label={lab}
      className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        color,
        // A tint rather than a fill, so it reads on both themes without
        // needing a second colour per theme.
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
      }}
    >
      {mark}
    </span>
  );
}

/**
 * A person's avatar, falling back to initials.
 *
 * The fallback is not decoration: an X profile picture is a remote URL that can
 * 404, be deleted, or be blocked, and a table of broken images looks broken.
 * Initials always render.
 */
export function Avatar({
  src,
  name,
  size = 22,
}: {
  src: string | null;
  name: string;
  size?: number;
}) {
  const initials = name
    .replace(/^@/, "")
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  if (!src) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-strong text-[9.5px] font-semibold text-foreground/60"
        style={{ width: size, height: size }}
        aria-hidden
      >
        {initials || "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote avatars from
    // arbitrary hosts, and a static export has no image optimizer to use anyway.
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-full border border-hairline object-cover"
      style={{ width: size, height: size }}
    />
  );
}
