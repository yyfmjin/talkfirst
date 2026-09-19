# INTERACTION_AUDIT

Popup / interaction audit across Web + Admin. Status per interaction: loading / disabled / ESC / outside-click / keyboard / mobile / error / success / retry.

---

## Confirm / destructive actions

| Interaction | Where | loading | disabled | ESC | outside-click | keyboard | error | success | retry |
|---|---|---|---|---|---|---|---|---|---|
| Delete moment | `moments/page.tsx:172-183` (`window.confirm`) | ✓ (`deleting`) | ✗ | n/a (native) | n/a | n/a | ✓ inline | ✓ (list update) | ✗ |
| Delete connection | `connections/page.tsx` | ✓ | — | n/a | n/a | n/a | ✓ | ✓ | ✓ |
| Admin status change | `users/[id]/page.tsx` + `ConfirmDialog` | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |
| Admin report review | `reports/[id]/page.tsx:328-345` | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |
| Remove block | `me/safety/page.tsx:53` | ✓ | — | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |

---

## Report

| Interaction | Where | status |
|---|---|---|
| Report user/message | `messages/[id]/safety-actions.tsx:34` | inline panel; loading ✓; error ✓; success via panel close; no retry toast. |

---

## Block

| Interaction | Where | status |
|---|---|---|
| Block / hide history | `messages/[id]/safety-actions.tsx:51` | inline panel; loading ✓; error ✓; no explicit success toast. |

---

## Share

| Interaction | Where | status |
|---|---|---|
| Share moment | `moments/page.tsx:185-198` | `navigator.share` / clipboard; success = `setShared` transient label; silent on cancel. |

---

## Login

| Interaction | Where | status |
|---|---|---|
| Web login | `login/page.tsx:85-88` | loading ✓ (button); error inline ✓. |
| Admin login | `login/page.tsx` | loading via button disabled; error inline ✓. |

---

## Image preview

- No dedicated image lightbox/preview component found; moment/message images rendered inline without zoom.

---

## Composer (post / comment)

| Interaction | Where | loading | disabled | empty | error | retry |
|---|---|---|---|---|---|---|
| Post composer | `moments/compose/page.tsx` | ✓ (`compose/page.tsx:185`) | ✓ (button state) | ✓ (content required) | ✓ | ✗ |
| Comment composer | `moments/page.tsx:154-170` | ✗ (no dedicated busy) | ✗ | ✓ (empty returns) | ✓ inline | ✗ |
| Message composer | `messages/[id]/page.tsx` | ✓ | — | ✓ | ✓ | ✗ |

---

## Summary gaps

- No unified modal contract (ESC / outside-click / focus trap) across the app.
- `window.confirm` used for destructive actions on the web side (no custom confirm).
- No toast/notification abstraction; success feedback is inconsistent (transient label vs nothing vs inline).
- Comment composer lacks a dedicated busy/disabled state.
