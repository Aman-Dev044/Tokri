import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

/**
 * The 20 most common passwords worldwide, per the annual breach-corpus
 * lists NCSC and HaveIBeenPwned publish. Compared case-insensitively.
 *
 * `MinLength(8)` already rejects most of these on length alone; this list
 * exists for the ones that clear 8 characters and would otherwise sail
 * straight through ("password1", "qwerty123", "iloveyou1", ...).
 */
export const TOP_20_COMMON_PASSWORDS: readonly string[] = [
  '123456',
  '123456789',
  'qwerty',
  'password',
  '12345678',
  '12345',
  '1234567',
  '111111',
  '1234567890',
  '123123',
  'abc123',
  '1q2w3e4r',
  'password1',
  'qwerty123',
  'letmein',
  'welcome',
  'monkey',
  'dragon',
  'iloveyou',
  '000000',
];

const COMMON_PASSWORDS_LOWER = new Set(
  TOP_20_COMMON_PASSWORDS.map((password) => password.toLowerCase()),
);

@ValidatorConstraint({ name: 'notCommonPassword', async: false })
class NotCommonPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' && !COMMON_PASSWORDS_LOWER.has(value.toLowerCase())
    );
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'password is one of the 20 most common passwords — choose something less guessable';
  }
}

/** Rejects the platform's list of the 20 most common passwords (case-insensitive). */
export function IsNotCommonPassword(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: NotCommonPasswordConstraint,
    });
  };
}
