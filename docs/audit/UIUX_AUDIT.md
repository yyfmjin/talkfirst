# UIUX_AUDIT

Web (`apps/web/src`) + Admin (`apps/admin/src`). Read-only.

---

## Design system primitives

| Concern | Web | Admin |
|---|---|---|
| Button | `components/ui.tsx`: `GradientButton`, `OutlineButton`, `SmallButton` | inline `button` classes (repeated `h-9 rounded-xl border border-line ...`) |
| Input | `Field` in `components/ui.tsx` | inline `input` classes |
| Card | hand-rolled per page | hand-rolled per page |
| Modal / Drawer | none (uses `window.confirm` in places) | `components/confirm-dialog.tsx` |
| Toast | none | none |
| Dropdown | none shared | none shared |
| Table | none shared | inline tables |
| Pagination | none (moments/comments unpaginated) | per-page inline pagination |
| Loading | page-specific skeletons | page-specific |
| Skeleton | `FeedSkeleton`, page skeletons | page skeletons |
| Empty | page-specific | page-specific |
| Error | page-specific inline + retry | page-specific inline |

---

## Typography / spacing / color

- Tailwind + shared `tf-gradient` / `tf-scroll` utilities in `globals.css`.
- No shared spacing/color token file beyond Tailwind defaults; admin uses raw `h-9`, `text-[13px]`, `border-line` literals repeated across pages.

---

## Consistency issues

| # | Issue | Evidence |
|---|---|---|
| 1 | Button styles duplicated across every admin page instead of a `Button` component. | `audit/page.tsx:102-113`, `blocks/page.tsx:206-296` all repeat the same `h-9 rounded-xl border ...` string. |
| 2 | Confirmation UX inconsistent: `window.confirm` (web moments delete `moments/page.tsx:173`) vs `ConfirmDialog` (admin) vs inline panel (chat safety). | — |
| 3 | Success/error feedback inconsistent: inline text, `window.alert`, or nothing. No toast system. | `me/page.tsx:44`, `moments/page.tsx:132` |
| 4 | `/me` loading is plain text "加载中…" with no skeleton (`me/page.tsx:44`), unlike other pages which have skeletons. | — |
| 5 | Admin `audit` page has no loading and no empty state (`audit/page.tsx`), unlike sibling pages. | — |
| 6 | Admin `login` page hardcodes `http://localhost:3001` and `Admin Console · 3001` in copy (`login/page.tsx:59`, `shell.tsx:67`). | — |

---

## Accessibility

- Modals: no shared focus-trap, ESC, or outside-click handling (admin `ConfirmDialog` needs manual review; web uses browser-native `confirm`).
- Buttons generally carry `type` and `disabled` states.
- No documented a11y baseline or axe checks.
- No `aria` patterns beyond native elements observed.

---

## Responsive

- Web: single `PhoneShell` (`components/phone-shell.tsx`) — full-screen below `sm`, 390px frame above.
- Admin: desktop-oriented; no explicit mobile pass observed.
- No 375/390/430/768/1440-specific breakpoints beyond the shell.

---

## Repeated / inconsistent patterns summary

- Buttons, inputs, tables, pagination, and empty/error states are re-implemented per page in both apps rather than shared.
- Two different confirmation mechanisms coexist (`window.confirm` vs `ConfirmDialog`).
- No notification/toast abstraction despite repeated success/error surfacing.
