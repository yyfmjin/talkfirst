import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from "@nestjs/common";
import { decodeNotificationCursor, type NotificationCursor } from "./notification-cursor";

/**
 * PC-3.1d — turns `?cursor=<opaque>` into a decoded position, or rejects it.
 *
 * This is the same shape of guard as `UuidParamPipe`: "is this value even
 * well-formed" is a statement about the wire format, so it belongs at the
 * transport boundary, and the service's contract stays "given this position,
 * build this query". Without it the service would have to throw, and a `400`
 * would be produced from inside the data layer.
 *
 * The error is the project's standard `VALIDATION_ERROR` envelope — the one
 * `ValidationPipe` and `UuidParamPipe` already emit — so a client keeps a single
 * branch for "your input was wrong" and no new `error.code` is introduced.
 *
 * ## Absent vs malformed
 *
 * `undefined` means "no cursor" and is passed straight through: that is the
 * first page, not an error. A *present but empty* cursor is malformed. A client
 * that appends `&cursor=` when it has no position is told so immediately; the
 * alternative — treating it as the first page — is how a paging loop silently
 * never terminates.
 */
@Injectable()
export class NotificationCursorPipe
  implements PipeTransform<string | undefined, NotificationCursor | undefined>
{
  transform(
    value: string | undefined,
    _metadata: ArgumentMetadata,
  ): NotificationCursor | undefined {
    if (value === undefined) return undefined;

    const cursor = decodeNotificationCursor(value);
    if (cursor) return cursor;

    throw new BadRequestException({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid query parameter",
        details: { cursor: ["cursor is not a cursor issued by this API"] },
      },
    });
  }
}
