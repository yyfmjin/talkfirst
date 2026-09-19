import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const ATTRIBUTE_KINDS = ["ABOUT_ME", "LOOKING_FOR"] as const;

@Controller("meta")
export class MetaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("interests")
  async interests() {
    const items = await this.prisma.interest.findMany({ orderBy: [{ category: "asc" }, { sort: "asc" }] });
    return { success: true as const, data: items };
  }

  @Get("purposes")
  async purposes() {
    const items = await this.prisma.purpose.findMany({ orderBy: { sort: "asc" } });
    return { success: true as const, data: items };
  }

  @Get("languages")
  async languages() {
    const items = await this.prisma.language.findMany({ orderBy: { code: "asc" } });
    return { success: true as const, data: items };
  }

  @Get("countries")
  async countries() {
    const items = await this.prisma.country.findMany({ orderBy: { code: "asc" } });
    return { success: true as const, data: items };
  }

  /**
   * PC-1.3: the selectable system tag catalog for the profile attribute picker.
   *
   * Retired tags (`isActive: false`) are excluded so they cannot be chosen
   * again, exactly as the attribute API enforces on write. They remain in the
   * table, so existing user selections still resolve on read (Q10).
   */
  @Get("attributes")
  async attributes(@Query("kind") kind?: string) {
    if (kind !== undefined && kind !== "" && !ATTRIBUTE_KINDS.includes(kind as never)) {
      throw new BadRequestException({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "kind must be ABOUT_ME or LOOKING_FOR" },
      });
    }
    const items = await this.prisma.attributeDefinition.findMany({
      where: { isActive: true, ...(kind ? { kind: kind as (typeof ATTRIBUTE_KINDS)[number] } : {}) },
      orderBy: [{ kind: "asc" }, { sort: "asc" }, { key: "asc" }],
    });
    return { success: true as const, data: items };
  }
}
