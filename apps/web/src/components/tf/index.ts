/**
 * TalkFirst Design System — component primitives (Phase A).
 *
 * ## What this folder is
 *
 * The reusable half of the design system: one implementation per UI role, built
 * only from the tokens in `@/design/tokens`. It exists because the audit counted
 * the same role implemented many times over — 7 primary buttons, 6 secondary
 * buttons, 10 avatars, 8 overlays, 6 chip families, 5 input families, 4 tab
 * implementations, 4 empty-state layouts, 3 error-state layouts, 18 skeletons and
 * no toast at all — with the duplicates disagreeing about height, radius, colour
 * and accessibility.
 *
 * ## Why nothing imports it yet
 *
 * This is Phase A. The pages still render their own markup, so this phase is
 * verifiable as a no-op: `tailwind.config.ts` gained names it did not have and
 * lost none, and no existing class changed meaning. Phases B–H migrate one screen
 * at a time, replacing a hand-rolled control with the primitive and deleting the
 * local copy.
 *
 * ## The rules these components encode
 *
 * **Blue means primary.** `brand-500` is for the primary action, the active state
 * and links. Nothing else. Status has its own colours (`success`/`warning`/
 * `danger`/`info`), and the social layer has `accent`.
 *
 * **One primary action per screen.** `TFButton variant="primary"` should never
 * appear twice in the same viewport. Everything else is `secondary`, `ghost`, an
 * icon button, or a row in a sheet.
 *
 * **Borders before shadows.** `TFCard` has no shadow by default. The elevation
 * scale is three steps and the middle one is rare.
 *
 * **Never colour alone.** Selected chips carry `aria-pressed` and a border, not
 * just a tint; tabs carry `aria-selected` and a rule.
 *
 * **Every state exists.** default, hover, focus-visible, active, disabled,
 * loading, error, empty. If a state is missing from a primitive it is a defect in
 * the primitive.
 *
 * Named with a `TF` prefix so a partially migrated file reads unambiguously: if
 * you can see `rounded-3xl` next to `<TFButton>`, that `rounded-3xl` is queued for
 * migration.
 */

export { TFButton, TFIconButton, type TFButtonProps, type TFIconButtonProps } from "./button";
export {
  TFField,
  TFInput,
  TFSearch,
  TFTextarea,
  type TFFieldProps,
  type TFInputProps,
  type TFSearchProps,
  type TFTextareaProps,
} from "./field";
export {
  TFAvatar,
  TFBadge,
  TFCard,
  TFChip,
  type TFAvatarProps,
  type TFCardProps,
  type TFTone,
} from "./display";
export { TFDialog, TFMenu, TFSheet, type TFMenuItem, type TFSheetProps } from "./overlay";
export {
  TFEmptyState,
  TFErrorState,
  TFLoadingRegion,
  TFRowSkeleton,
  TFSkeleton,
  TFToastProvider,
  useToast,
} from "./feedback";
export {
  TFListRow,
  TFSectionHeader,
  TFTabs,
  type TFTabItem,
} from "./nav";
