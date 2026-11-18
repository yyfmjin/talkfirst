import { Module } from "@nestjs/common";
import { SafetyModule } from "../safety/safety.module";
import { TreeHoleController } from "./tree-hole.controller";
import { TreeHoleService } from "./tree-hole.service";

/**
 * 树洞（2026-11-12）。
 *
 * PrismaModule 是 @Global，不用 import；SafetyModule 是显式依赖（发帖/评论要过扫描）。
 */
@Module({
  imports: [SafetyModule],
  controllers: [TreeHoleController],
  providers: [TreeHoleService],
})
export class TreeHoleModule {}
