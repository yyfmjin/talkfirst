import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

/**
 * 树洞（2026-11-12）—— 匿名吐槽板。
 *
 * ## 匿名是硬约束，不是展示层的选择
 *
 * `userId` 会落库，但**只用于**三件事：限流、投诉处理、注销时级联删除。
 * 任何返回值里都没有它；对外身份只有 `alias`。
 *
 * ## alias 为什么是 hash 而不是随机数
 *
 * 由 `(scope, userId)` 派生：同一个人在同一个帖子下拿到同一个别名 —— 读起来能看出
 * 「楼主又说话了」，但看不出来是谁。随机数会让同一个人每条评论换一个名字，
 * 对话读不通；而把 userId 直接发出去，匿名就没了。
 *
 * 帖子用 `(postId, userId)` 做 scope（每个帖子互不相干），不跨帖聚合，
 * 免得把一个人在不同帖子里的发言串起来做画像。
 */

const MAX_POST_LENGTH = 500;
const MAX_COMMENT_LENGTH = 300;
const PAGE_SIZE = 20;

function aliasFor(scope: string, userId: string): string {
  const digest = createHash("sha256").update(`${scope}:${userId}`).digest("hex");
  return `树友·${digest.slice(0, 4).toUpperCase()}`;
}

export type TreeHolePostView = {
  id: string;
  alias: string;
  content: string;
  commentCount: number;
  createdAt: Date;
};

@Injectable()
export class TreeHoleService {
  constructor(private readonly prisma: PrismaService) {}

  private clean(content: unknown, max: number, code: string) {
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) {
      throw new BadRequestException({
        success: false,
        error: { code, message: "Content is required" },
      });
    }
    if (text.length > max) {
      throw new BadRequestException({
        success: false,
        error: { code, message: `Content must be at most ${max} characters` },
      });
    }
    return text;
  }

  async list(cursor?: string, limit = PAGE_SIZE) {
    const take = Math.min(Math.max(limit, 1), 50);
    const rows = await this.prisma.treeHolePost.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, alias: true, content: true, commentCount: true, createdAt: true },
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  }

  async create(userId: string, content: unknown) {
    const text = this.clean(content, MAX_POST_LENGTH, "TREE_HOLE_EMPTY");
    const id = randomUUID();
    const created = await this.prisma.treeHolePost.create({
      data: { id, userId, alias: aliasFor(id, userId), content: text },
      select: { id: true, alias: true, content: true, commentCount: true, createdAt: true },
    });
    return created;
  }

  async comments(postId: string, limit = 50) {
    const post = await this.prisma.treeHolePost.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true },
    });
    if (!post) {
      throw new NotFoundException({
        success: false,
        error: { code: "TREE_HOLE_NOT_FOUND", message: "Post not found" },
      });
    }
    const take = Math.min(Math.max(limit, 1), 100);
    const items = await this.prisma.treeHoleComment.findMany({
      where: { postId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      take,
      select: { id: true, alias: true, content: true, createdAt: true },
    });
    return { items };
  }

  async addComment(userId: string, postId: string, content: unknown) {
    const text = this.clean(content, MAX_COMMENT_LENGTH, "TREE_HOLE_COMMENT_EMPTY");
    const post = await this.prisma.treeHolePost.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, userId: true, alias: true },
    });
    if (!post) {
      throw new NotFoundException({
        success: false,
        error: { code: "TREE_HOLE_NOT_FOUND", message: "Post not found" },
      });
    }

    // 楼主自己回帖沿用楼主那个别名：读得出来是楼主的续言，但仍然不知道是谁。
    const alias = post.userId === userId ? post.alias : aliasFor(postId, userId);

    /*
     * 评论与计数必须一起成功：`commentCount` 是列表页显示的那个数字，
     * 分开写会出现「有评论但显示 0 条」，而这种小数字错了没人会去查。
     */
    const created = await this.prisma.$transaction(async (tx) => {
      const comment = await tx.treeHoleComment.create({
        data: { postId, userId, alias, content: text },
        select: { id: true, alias: true, content: true, createdAt: true },
      });
      await tx.treeHolePost.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      });
      return comment;
    });

    return created;
  }
}
