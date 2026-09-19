import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type SafetyScan = {
  level: RiskLevel;
  reasons: string[];
  hasExternalLink: boolean;
  hasContactLeak: boolean;
  blocked: boolean;
};

// MVP keyword safety net (readme §48/50/54): keyword + report + manual review.
// Later phases can replace scanText() with an AI moderation provider.
const HIGH_RISK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /earn\s+money|make\s+money\s+fast|passive\s+income/i, reason: "疑似金钱/收益诱导" },
  { pattern: /investment|guaranteed\s+return|double\s+your/i, reason: "疑似投资诈骗" },
  { pattern: /crypto|bitcoin|usdt|binance|airdrop/i, reason: "疑似加密/空投诈骗" },
  { pattern: /casino|betting|lottery|gambling/i, reason: "疑似赌博" },
  { pattern: /click\s+this\s+link|free\s+gift|claim\s+now/i, reason: "疑似钓鱼链接诱导" },
];

const MEDIUM_RISK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /telegram\s+group|whatsapp\s+group|join\s+my\s+group/i, reason: "疑似站外引流" },
  { pattern: /onlyfans|nude|sexy\s+pic|explicit/i, reason: "疑似色情内容" },
];

const CONTACT_LEAK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\+?\d[\d\s\-()]{7,}\d/, reason: "疑似电话号码" },
  { pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, reason: "疑似邮箱" },
  { pattern: /@[\w_]{4,}/, reason: "疑似站外用户名" },
  { pattern: /(t\.me\/|telegram:|whatsapp:|line:|wechat|微信|qq\s*[:：]?\s*\d|instagram|ins\s*[:：]?)/i, reason: "疑似社交账号" },
];

const EXTERNAL_LINK_PATTERN = /https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|app|me|xyz|top|link)(\/\S*)?/i;

@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService) {}

  scanText(content: string): SafetyScan {
    const text = content ?? "";
    const reasons: string[] = [];

    for (const item of HIGH_RISK_PATTERNS) {
      if (item.pattern.test(text)) reasons.push(item.reason);
    }
    for (const item of MEDIUM_RISK_PATTERNS) {
      if (item.pattern.test(text)) reasons.push(item.reason);
    }

    const contactReasons = CONTACT_LEAK_PATTERNS.filter((item) => item.pattern.test(text)).map(
      (item) => item.reason,
    );
    const hasExternalLink = EXTERNAL_LINK_PATTERN.test(text);
    const hasContactLeak = contactReasons.length > 0;

    const level: RiskLevel = reasons.length > 0 ? "HIGH" : hasContactLeak || hasExternalLink ? "MEDIUM" : "LOW";
    const blocked = /child|minor\s+sex|teen\s+sex|csam/i.test(text);

    return {
      level,
      reasons: [...new Set([...reasons, ...(level === "MEDIUM" ? contactReasons : []), ...(hasExternalLink ? ["包含外部链接"] : [])])],
      hasExternalLink,
      hasContactLeak,
      blocked,
    };
  }

  async trustedAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, status: true },
    });
    if (!user) return false;
    const ageDays = (Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays >= 7) return true;
    const [connections, messages, requests] = await Promise.all([
      this.prisma.connection.count({
        where: { status: "ACTIVE", OR: [{ userAId: userId }, { userBId: userId }] },
      }),
      this.prisma.message.count({ where: { senderId: userId, deletedAt: null } }),
      this.prisma.connectionRequest.count({ where: { senderId: userId } }),
    ]);
    const active = connections >= 3 || messages >= 30 || requests >= 10;
    return active && user.status === "ACTIVE";
  }

  async sayHelloLimit(userId: string) {
    const trusted = await this.trustedAccount(userId);
    return trusted ? 50 : 20;
  }

  extractLinks(content: string) {
    const matches = content.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi);
    return [...new Set(matches ?? [])].slice(0, 5);
  }

  // Machine signals are intentionally not persisted until the Report schema has
  // a separate nullable reporter/source contract. Keeping them out of Report
  // prevents automated detections from entering the manual moderation queue.
  async recordAutoFlag(input: {
    userId: string;
    reasons: string[];
    messageId?: string;
    source: string;
    level?: RiskLevel;
  }): Promise<{ reportId: string | null; deduped: boolean }> {

    const { userId, reasons, messageId, level } = input;
    // Auto-flagged messages are machine signals, never user reports. A machine
    // signal must not be written into the Report table: Report.reporterId is a
    // required FK to User, so an automated flag written as a report would file
    // the *victim* as their own reporter and push it into the manual queue the
    // readme (§48/54/55) reserves for human reports.
    if (level === "HIGH") {
      return { reportId: null, deduped: false };
    }

    // Deduplication: check existing report with same reported user, reason, and optional messageId
    const reason = reasons.length > 0 ? reasons[0] : "UNKNOWN";
    const existing = await this.prisma.report.findFirst({
      where: {
        reportedUserId: userId,
        reason,
        ...(messageId ? { messageId } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      return { reportId: existing.id, deduped: true };
    }

    // Create new report
    const created = await this.prisma.report.create({
      data: {
        reporterId: userId,
        reportedUserId: userId,
        reason,
        messageId,
        status: "OPEN",
      },
      select: { id: true },
    });
    return { reportId: created.id, deduped: false };
  }
}
