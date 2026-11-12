import { Module } from "@nestjs/common";
import { TreeHoleController } from "./tree-hole.controller";
import { TreeHoleService } from "./tree-hole.service";

/** 树洞（2026-11-12）。PrismaModule 是 @Global，所以这里不用再 import。 */
@Module({
  controllers: [TreeHoleController],
  providers: [TreeHoleService],
})
export class TreeHoleModule {}
