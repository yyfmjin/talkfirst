/**
 * The admin module's original home of `UuidParamPipe`.
 *
 * The implementation moved to `../common/uuid-param.pipe` so the member APIs can
 * use it without depending on the admin module. `AdminController` and this
 * directory's specs keep importing `./uuid-param.pipe`, which is why this file
 * re-exports rather than disappearing.
 */
export { UuidParamPipe } from "../common/uuid-param.pipe";
