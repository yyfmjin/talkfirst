import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Throttle } from "@nestjs/throttler";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { ValidationPipe } from "../common/validation.pipe";
import { FEEDBACK_MAX_BODY, FeedbackService } from "./feedback.service";

/**
 * Member-facing feedback ("意见反馈").
 *
 * ## Why the screen fetches its own copy
 *
 * The address shown to members is editable at runtime, so it cannot be baked into the
 * frontend build or read from a client-side environment variable — a Next.js public env
 * var is fixed at build time, which would make the admin setting useless. `GET /feedback`
 * is therefore the one call the screen makes before it can render.
 *
 * ## Why submission is throttled harder than reads
 *
 * A submission writes a row that a human later reads. Without a limit, one account can
 * fill the queue and make it useless — the same reasoning as the other write endpoints
 * on this API, with a tighter number because a legitimate member sends a handful of
 * messages, not dozens.
 *
 * ## Validation lives in the service
 *
 * Length, emptiness, address shape and the kind coercion are all enforced in
 * `FeedbackService`, so the rules hold for any caller rather than only for requests
 * that passed through this DTO.
 */

class SubmitFeedbackDto {
  @IsString()
  @MaxLength(FEEDBACK_MAX_BODY)
  body!: string;

  @IsOptional()
  @IsIn(["SUGGESTION", "BUG", "COMPLAINT", "OTHER"])
  kind?: string;

  /** Optional: the member may want the answer at a different address. */
  @IsOptional()
  @IsString()
  @MaxLength(320)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  source?: string;
}

@Controller("feedback")
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** What the form needs: the current support address and the length bound. */
  @Get()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async context() {
    return { success: true as const, data: await this.feedback.submissionContext() };
  }

  /** The member's own submissions, so they can see whether it was answered. */
  @Get("mine")
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async mine(
    @CurrentUser() user: AuthUser,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return {
      success: true as const,
      data: await this.feedback.listMine(user.id, Number(page), Number(pageSize)),
    };
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async submit(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: SubmitFeedbackDto) {
    return {
      success: true as const,
      data: await this.feedback.submit(user.id, dto),
    };
  }
}
