import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class SendRequestDto {
  @IsString()
  receiverId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  @IsOptional()
  @IsIn(["gaming", "country", "language", "music", "travel", "custom"])
  templateId?: string;
}

export class RespondRequestDto {
  @IsIn(["accept", "reject"])
  action!: "accept" | "reject";
}
