"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiRequestError, apiFetch, apiSend } from "@/lib/api";
import { useAdminSession } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

/**
 * 发现页类别 — the filter tabs on the member discovery screen.
 *
 * ## Why this replaced two hardcoded arrays
 *
 * The tabs lived in `apps/web/src/app/discover/page.tsx` (`FILTERS`) and the matching rule
 * in `DiscoverService` (`if (filter === "language") … else if (filter === "gaming") …`,
 * with the gaming slugs listed inline). Adding a category meant editing both and
 * redeploying, which is why the product shipped with two.
 *
 * ## What an operator actually types
 *
 * A **keyword list**: the interest and purpose slugs a candidate must have for the tab to
 * include them. That is the whole matching rule — `minecraft, steam, gaming` means "people
 * whose interests or purposes include one of these".
 *
 * The slugs are not free-form guesses: they come from the same `Interest` / `Purpose`
 * vocabularies the profile screens use, so an operator needs the exact slug rather than a
 * display name. The form therefore shows the built-in pair's real values as examples
 * instead of describing the field in the abstract.
 *
 * ## Why the slug cannot be edited afterwards
 *
 * It is what a client sends in the query string and what a bookmarked tab holds. Renaming
 * it would silently break both, so the field is create-only and the labels are what an
 * operator changes.
 */

type Category = {
  id: string;
  slug: string;
  label: string;
  labelZh: string | null;
  keywords: string[];
  sort: number;
  isActive: boolean;
  createdAt: string;
};

export default function DiscoverCategoriesPage() {
  return (
    <Shell>
      <DiscoverCategoriesScreen />
    </Shell>
  );
}

function DiscoverCategoriesScreen() {
  const { identity } = useAdminSession();
  const canRead = Boolean(identity && hasPermission(identity.role, "settings:read"));
  const canWrite = Boolean(identity && hasPermission(identity.role, "settings:write"));

  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [keywords, setKeywords] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");

  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ items: Category[] }>("/admin/categories/discover?includeInactive=true");
      setItems(data.items);
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    setCreating(true);
    try {
      await apiSend("/admin/categories/discover", "POST", {
        slug: slug.trim(),
        label: label.trim(),
        keywords: keywords.trim(),
      });
      setNotice(`已添加类别 ${label.trim()}`);
      setSlug("");
      setLabel("");
      setKeywords("");
      await load();
    } catch (requestError) {
      // The API's messages name the exact problem (duplicate slug, malformed slug,
      // missing label), and they are the actionable part — not generalised here.
      setFormError(friendlyError(requestError));
    } finally {
      setCreating(false);
    }
  }

  function beginEdit(item: Category) {
    setEditing(item.id);
    setEditLabel(item.labelZh ?? item.label);
    setEditKeywords(item.keywords.join(", "));
  }

  async function saveEdit(item: Category) {
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      await apiSend(`/admin/categories/discover/${item.id}`, "PATCH", {
        labelZh: editLabel.trim(),
        keywords: editKeywords.trim(),
      });
      setNotice("已保存");
      setEditing(null);
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(item: Category) {
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      await apiSend(`/admin/categories/discover/${item.id}`, "PATCH", { isActive: !item.isActive });
      setNotice(item.isActive ? "已停用" : "已启用");
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: Category) {
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      await apiSend(`/admin/categories/discover/${item.id}`, "DELETE");
      setNotice(`已删除 ${item.label}`);
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[20px] font-semibold">发现页类别</h1>
      <p className="mt-1 text-[13px] text-muted">
        「发现」页顶部的筛选标签。关键词决定某个人是否属于该类别：填写资料里兴趣或交友目的的
        <span className="font-mono"> slug </span>
        （例如 <span className="font-mono">minecraft</span>、<span className="font-mono">steam</span>、
        <span className="font-mono">language-exchange</span>），多个用逗号分隔。
      </p>

      {notice ? (
        <p data-testid="discover-category-notice" className="mt-3 text-[13px] text-success-ink">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p data-testid="discover-category-error" className="mt-3 text-[13px] text-red-500">
          {error}
        </p>
      ) : null}

      {!canRead ? (
        <p data-testid="discover-category-forbidden" className="mt-5 text-[13px] text-muted">
          你的角色没有管理发现页类别的权限。
        </p>
      ) : (
        <>
          {canWrite ? (
            <form
              onSubmit={create}
              data-testid="discover-category-form"
              className="mt-5 rounded-2xl border border-line bg-card p-4 shadow-card"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="text-[12px] text-muted">标识（创建后不可修改）</span>
                  <input
                    data-testid="discover-category-slug"
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                    placeholder="travel"
                    className="mt-1 h-10 w-full rounded-xl border border-line px-3 font-mono text-[13px] outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[12px] text-muted">显示名称</span>
                  <input
                    data-testid="discover-category-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="旅行"
                    className="mt-1 h-10 w-full rounded-xl border border-line px-3 text-[13px] outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[12px] text-muted">关键词（逗号分隔）</span>
                  <input
                    data-testid="discover-category-keywords"
                    value={keywords}
                    onChange={(event) => setKeywords(event.target.value)}
                    placeholder="travel, backpacking"
                    className="mt-1 h-10 w-full rounded-xl border border-line px-3 font-mono text-[12px] outline-none"
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="submit"
                  data-testid="discover-category-submit"
                  disabled={creating || !slug.trim() || !label.trim()}
                  className="h-10 rounded-xl bg-primary-ink px-4 text-[13px] font-medium text-white disabled:opacity-50"
                >
                  添加类别
                </button>
                {formError ? (
                  <span data-testid="discover-category-form-error" className="text-[13px] text-red-500">
                    {formError}
                  </span>
                ) : null}
              </div>
            </form>
          ) : null}

          {loading ? (
            <p data-testid="discover-category-loading" className="mt-6 text-[13px] text-muted">
              加载中…
            </p>
          ) : items.length === 0 ? (
            <p data-testid="discover-category-empty" className="mt-6 text-[13px] text-muted">
              还没有自定义类别。此时「发现」页使用内置的两个标签（全部 / 语言交换 / 游戏搭子）。
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  data-testid={`discover-category-item-${item.id}`}
                  className="rounded-2xl border border-line bg-card p-4 shadow-card"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] text-muted">{item.slug}</span>
                    <span className="text-[14px] font-medium">{item.labelZh ?? item.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        item.isActive
                          ? "bg-success-wash text-success-ink"
                          : "bg-neutral-wash text-neutral-ink"
                      }`}
                    >
                      {item.isActive ? "启用中" : "已停用"}
                    </span>
                    <span className="text-[12px] text-muted">排序 {item.sort}</span>
                  </div>

                  {editing === item.id ? (
                    <div className="mt-3 space-y-2">
                      <input
                        data-testid={`discover-category-edit-label-${item.id}`}
                        value={editLabel}
                        onChange={(event) => setEditLabel(event.target.value)}
                        placeholder="显示名称"
                        className="h-9 w-full rounded-xl border border-line px-3 text-[13px] outline-none"
                      />
                      <input
                        data-testid={`discover-category-edit-keywords-${item.id}`}
                        value={editKeywords}
                        onChange={(event) => setEditKeywords(event.target.value)}
                        placeholder="travel, backpacking"
                        className="h-9 w-full rounded-xl border border-line px-3 font-mono text-[12px] outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          data-testid={`discover-category-save-${item.id}`}
                          disabled={busyId === item.id}
                          onClick={() => void saveEdit(item)}
                          className="h-9 rounded-xl bg-primary-ink px-3 text-[12px] text-white disabled:opacity-50"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="h-9 rounded-xl border border-line px-3 text-[12px] text-muted"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 font-mono text-[12px] text-muted">
                        {item.keywords.length > 0 ? item.keywords.join(", ") : "（无关键词：该标签不会被用作过滤）"}
                      </p>
                      {canWrite ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            data-testid={`discover-category-edit-${item.id}`}
                            onClick={() => beginEdit(item)}
                            className="h-9 rounded-xl border border-line px-3 text-[12px] text-muted"
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            data-testid={`discover-category-toggle-${item.id}`}
                            disabled={busyId === item.id}
                            onClick={() => void toggleActive(item)}
                            className="h-9 rounded-xl border border-line px-3 text-[12px] text-muted disabled:opacity-50"
                          >
                            {item.isActive ? "停用" : "启用"}
                          </button>
                          <button
                            type="button"
                            data-testid={`discover-category-delete-${item.id}`}
                            disabled={busyId === item.id}
                            onClick={() => void remove(item)}
                            className="h-9 rounded-xl border border-danger px-3 text-[12px] text-danger disabled:opacity-50"
                          >
                            删除
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function friendlyError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "操作失败，请稍后重试";
  const message = error.message ?? "";
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return "操作失败，请稍后重试";
  }
  return message;
}
