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
            "inline-flex max-w-full items-center gap-1 rounded-full px-3 py-1 text-[11px]",
            tone === "about" ? "bg-[#F1F3FF] text-[#6572D8]" : "bg-[#F4F1FF] text-[#7C5CD6]",
          )}
        >
          <span className="min-w-0 truncate">{attributeLabel(attribute)}</span>
          {attribute.value ? <span className="min-w-0 truncate opacity-70">· {attribute.value}</span> : null}
          {showRetired && attribute.definitionActive === false ? (
            <span className="shrink-0 rounded-full bg-white/80 px-1.5 text-[10px] text-[#B26A00]">已停用</span>
          ) : null}
        </span>
      ))}
      {overflow > 0 ? <span className="px-1 text-[11px] text-muted">+{overflow}</span> : null}
    </div>
  );
}
