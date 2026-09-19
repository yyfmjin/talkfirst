import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const PLATFORMS = [
  "INSTAGRAM",
  "TELEGRAM",
  "WHATSAPP",
  "DISCORD",
  "X",
  "TIKTOK",
  "WECHAT",
  "QQ",
  "STEAM",
] as const;

export class CreateExchangeDto {
  @IsString({ each: true })
  @IsIn([...PLATFORMS], { each: true })
  platforms!: Array<(typeof PLATFORMS)[number]>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;
}

export class RespondExchangeDto {
  @IsIn(["accept", "reject"])
  action!: "accept" | "reject";
}

export class UpsertSocialAccountDto {
  @IsIn([...PLATFORMS])
  platform!: (typeof PLATFORMS)[number];

  @IsString()
  @MaxLength(128)
  handle!: string;
}
