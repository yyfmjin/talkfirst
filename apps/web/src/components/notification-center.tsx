"use client";

import { useCallback, useEffect, useState } from "react";
import { NotificationItem, useNotificationReader } from "@/components/notification-item";
import { ScreenHeader } from "@/components/screen-header";
import { TFButton, TFLoadingRegion, TFSkeleton } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import {
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_TYPES,
  type NotificationPage,
  type NotificationRecord,
} from "@/lib/notifications";

/**
 * PC-3.1e — the Notification Center.
 *
 * The list is `GET /notifications`, read a page at a time. The API's cursor is
 * opaque and already ordered `createdAt DESC, id DESC`, so this component never
 * sorts, dedupes or reconciles: "load more" *appends* the next page to what is
 * on screen, and a filter change drops both the rows and the cursor before
 * refetching, because a cursor belongs to the query that produced it.
 *
 * `unread` is the number the API returned, never a count of the loaded rows. It
 * is the user's whole unread total, so it stays correct while a type filter
 * hides most of those rows, and it is what "全部已读" (one
 * `POST /notifications/read`) drops to zero. Marking all read updates the rows
 * on screen instead of refetching, so nothing flickers and the badge cannot
 * disagree with the list.
 *
 * Read rows are marked one at a time through `useNotificationReader`, which owns
 * the read-then-navigate order and the "never fake a success" rule. The three
 * failure modes stay apart: a failed *first page* replaces the list with a retry
 * panel, a failed *append* keeps the rows and reports itself above the button,
 * and a failed *mark read* leaves the row unread.
 */

const PAGE_SIZE = 20;

type TypeFilter = "ALL" | (typeof NOTIFICATION_TYPES)[number];

export function NotificationCenter() {
  const [filter, setFilter] = useState<TypeFilter>("ALL");
  const [reloadKey, setReloadKey] = useState(0);
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [markAllError, setMarkAllError] = useState("");
  const [markingAll, setMarkingAll] = useState(false);

  const onMarked = useCallback((notification: NotificationRecord) => {
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.id === notification.id ? { ...item, readAt } : item)),
    );
    setUnread((current) => Math.max(0, current - 1));
  }, []);
  const { activate, pendingId, error: actionError } = useNotificationReader(onMarked);

  const fetchPage = useCallback(async (type: TypeFilter, cursor: string | null) => {
    const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (type !== "ALL") query.set("type", type);
    if (cursor) query.set("cursor", cursor);
    return apiFetch<NotificationPage>(`/notifications?${query.toString()}`);
  }, []);

  // First page, and every filter change / retry. A filter change clears the
  // cursor chain as well as the rows: the old cursor belongs to the old query.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError("");
    setMoreError("");
    setItems([]);
    setNextCursor(null);
    void fetchPage(filter, null)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setUnread(page.unread);
        setNextCursor(page.nextCursor);
      })
      .catch((requestError) => {
        if (cancelled) return;
        setPageError(friendlyErrorMessage(requestError, "通知加载失败，请稍后重试。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, filter, reloadKey]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await fetchPage(filter, nextCursor);
      setItems((current) => [...current, ...page.items]);
      setUnread(page.unread);
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      setMoreError(friendlyErrorMessage(requestError, "加载更多失败，请稍后重试。"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAllRead() {
    if (markingAll || unread === 0) return;
    setMarkingAll(true);
    setMarkAllError("");
    try {
      await apiFetch("/notifications/read", { method: "POST" });
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt })));
      setUnread(0);
    } catch (requestError) {
      setMarkAllError(friendlyErrorMessage(requestError, "全部已读失败，请稍后重试。"));
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <>
      <ScreenHeader
        title="通知"
        backHref="/messages"
        action={
          <button
            type="button"
            data-testid="notification-mark-all"
            onClick={() => void markAllRead()}
            disabled={markingAll || unread === 0}
            className="shrink-0 whitespace-nowrap rounded-control px-2 py-1 text-caption font-medium text-brand-600 underline decoration-dotted transition-colors duration-instant hover:bg-surface-sunken disabled:opacity-40 disabled:no-underline disabled:hover:bg-transparent"
          >
            {markingAll ? "处理中…" : "全部已读"}
          </button>
        }
      />

      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <div className="flex items-center justify-between gap-3">
          {/*
            A NATIVE `<select>` on purpose. `notification.spec.ts` drives it with
            `selectOption("MOMENT_REPLY")` and reads its `<option>` labels, so
            replacing it with a custom listbox would break the suite and lose the
            platform picker for free. Only the palette is tokenised.
          */}
          <select
            aria-label="通知类型"
            data-testid="notification-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as TypeFilter)}
            className="h-9 min-w-0 max-w-[62%] rounded-control border border-border bg-surface px-3 text-caption text-content transition-colors duration-instant focus:border-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          >
            <option value="ALL">全部</option>
            {NOTIFICATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {NOTIFICATION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <span data-testid="notification-unread-count" className="shrink-0 text-caption text-content-muted">
            未读 {unread}
          </span>
        </div>

        {/* The `notification-loading` testid must exist *while* the request is in
            flight — the suite asserts it reaches 0. `TFLoadingRegion` renders its
            own wrapper, so the testid goes on the inner list. */}
        {loading ? (
          <TFLoadingRegion label="正在加载通知">
            <div data-testid="notification-loading" className="mt-4 space-y-2">
              <TFSkeleton shape="block" className="h-[68px] w-full" />
              <TFSkeleton shape="block" className="h-[68px] w-full" />
              <TFSkeleton shape="block" className="h-[68px] w-full" />
            </div>
          </TFLoadingRegion>
        ) : null}

        {!loading && pageError ? (
          <div className="mt-4">
            <p data-testid="notification-error" role="alert" className="break-words text-ui font-medium text-danger-700">
              {pageError}
            </p>
            <TFButton
              variant="secondary"
              fullWidth
              className="mt-3"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              重试
            </TFButton>
          </div>
        ) : null}

        {!loading && !pageError && items.length === 0 ? (
          <p
            data-testid="notification-empty"
            className="mt-6 rounded-card bg-surface-sunken p-5 text-center text-ui leading-5 text-content-muted"
          >
            暂无通知
          </p>
        ) : null}

        {!loading && !pageError && items.length > 0 ? (
          <>
            {markAllError ? (
              <p
                data-testid="notification-mark-all-error"
                role="alert"
                className="mt-3 break-words text-caption text-danger-600"
              >
                {markAllError}
              </p>
            ) : null}
            {actionError ? (
              <p
                data-testid="notification-action-error"
                role="alert"
                className="mt-3 break-words text-caption text-danger-600"
              >
                {actionError}
              </p>
            ) : null}

            {/* `space-y-2`, NOT `divide-y`: `NotificationItem` is itself a bordered
                card (it has to be — the same component renders standalone in the
                messages hub), so a hairline between cards would double the edge. */}
            <div className="mt-3 space-y-2">
              {items.map((item) => (
                <NotificationItem
                  key={item.id}
                  notification={item}
                  pending={pendingId === item.id}
                  onActivate={(notification) => void activate(notification)}
                />
              ))}
            </div>

            {moreError ? (
              <p
                data-testid="notification-more-error"
                role="alert"
                className="mt-3 break-words text-center text-caption text-danger-600"
              >
                {moreError}
              </p>
            ) : null}

            {nextCursor ? (
              <div className="mt-4 flex justify-center">
                <TFButton
                  variant="secondary"
                  size="sm"
                  data-testid="notification-load-more"
                  onClick={() => void loadMore()}
                  loading={loadingMore}
                  loadingLabel="加载中…"
                >
                  加载更多
                </TFButton>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
