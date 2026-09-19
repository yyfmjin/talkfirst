import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from "@nestjs/common";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

@Injectable()
export class ValidationPipe implements PipeTransform {
  async transform(value: unknown, metadata: ArgumentMetadata) {
    if (!metadata.metatype || !this.toValidate(metadata.metatype)) {
      return value;
    }
    const object = plainToInstance(metadata.metatype, value);
    // Phase A hardening: `whitelist` strips properties that have no validation
    // decorator, and `forbidNonWhitelisted` rejects the request outright when
    // such a property is present. Together they close the mass-assignment
    // surface — previously an unknown field (e.g. `isAdmin`) survived onto the
    // DTO instance and relied on every service remembering to build an explicit
    // field allowlist. Services still do that, but this is now defence in depth.
    const errors = await validate(object as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      const details: Record<string, string[]> = {};
      for (const error of errors) {
        details[error.property] = Object.values(error.constraints ?? {});
      }
      throw new BadRequestException({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid request payload", details },
      });
    }
    return object;
  }

  private toValidate(metatype: unknown): boolean {
    const types: unknown[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
