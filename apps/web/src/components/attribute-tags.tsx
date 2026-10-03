import { attributeLabel, type AttributeView } from "@/lib/profile";
import { cn } from "@/lib/cn";

/**
 * PC-1.4: the single renderer for `ABOUT_ME` / `LOOKING_FOR` tags.
 *
 * The preview card and the full profile both use this, so a tag cannot render
 * one way in the card and another on the detail page. Retired system tags
 * (`definitionActive === false`) are deliberately still shown — PC-1.2 Q10
 * keeps an existing selection alive after an admin stops offering it — and the
 * `showRetired` marker is only enabled where the viewer is the owner.
 */
export function AttributeTagList({
  attributes,
  tone,
  limit,
  showRetired = false,
}: {
  attributes: AttributeView[];
  tone: "about" | "looking";
  limit?: number;
  showRetired?: boolean;
}) {
  if (attributes.length === 0) return null;
  const visible = limit ? attributes.slice(0, limit) : attributes;
  const overflow = attributes.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((attribute) => (
        <span
          key={attribute.id}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full px-3 py-1 text-overline",
            /* Two tones, two meanings: 「关于我」 uses the brand blue, 「交友需求」
               the accent purple. Both are now tokens rather than one-off hexes. */
            tone === "about" ? "bg-brand-50 text-brand-600" : "bg-accent-50 text-accent-600",
          )}
        >
          <span className="min-w-0 truncate">{attributeLabel(attribute)}</span>
          {attribute.value ? <span className="min-w-0 truncate opacity-70">· {attribute.value}</span> : null}
          {showRetired && attribute.definitionActive === false ? (
            <span className="shrink-0 rounded-full bg-surface/80 px-1.5 text-overline text-warning-800">已停用</span>
          ) : null}
        </span>
      ))}
      {overflow > 0 ? <span className="px-1 text-overline text-content-muted">+{overflow}</span> : null}
    </div>
  );
}
