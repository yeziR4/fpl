import { labLogoUrl, labMeta } from "@/lib/study";

/**
 * Small identity marks: a lab logo for an agent, an avatar for a person.
 *
 * The lab badge shows the lab's own logo. An earlier version drew a monogram
 * instead, on the reasoning that a vendor's mark implies an association that
 * does not exist. That concern is real, but refusing to name the models is not
 * the answer -- this is a benchmark table comparing five named systems, it never
 * claims endorsement, and the submission states that none of the labs were
 * involved.
 *
 * The monogram is still there, UNDER the image rather than replaced by it. An
 * `<img>` whose src fails is a broken icon, and a table of broken icons looks
 * broken; layering means a failed fetch degrades to a deliberate badge instead.
 */

export function LabBadge({ slug, size = 22 }: { slug: string; size?: number }) {
  const { mark, color, lab } = labMeta(slug);
  const logo = labLogoUrl(slug, 64);

  return (
    <span
      title={lab}
      aria-label={lab}
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        color,
        // A tint rather than a fill, so it reads on both themes without needing
        // a second colour per theme.
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
      }}
    >
      {/* The fallback, underneath. Visible if the logo is missing or fails. */}
      <span aria-hidden>{mark}</span>
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element -- a third-party
        // favicon endpoint, and a static export has no image optimizer anyway.
        <img
          src={logo}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          className="absolute inset-0 h-full w-full bg-white object-contain p-[10%]"
        />
      )}
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
