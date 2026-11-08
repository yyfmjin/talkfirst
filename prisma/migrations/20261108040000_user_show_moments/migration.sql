-- 资料卡上是否展示「个人动态」入口。默认开，老用户行为不变。
ALTER TABLE "User" ADD COLUMN "showMomentsOnProfile" BOOLEAN NOT NULL DEFAULT true;
