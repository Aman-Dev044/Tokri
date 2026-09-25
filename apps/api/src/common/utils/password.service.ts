import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

/**
 * Password hashing — argon2id with a secret pepper.
 *
 * The pepper comes from ARGON2_PEPPER and exists only in the environment.
 * A stolen database therefore is not enough to brute-force the hashes:
 * the attacker also needs the environment secret.
 *
 * Parameters follow the OWASP argon2id recommendation (19 MiB, t=2, p=1).
 */
@Injectable()
export class PasswordService {
  private readonly pepper: Buffer;

  constructor(config: ConfigService) {
    // getOrThrow — never a `||` fallback. If the pepper is missing the
    // process should already have failed validation at boot.
    this.pepper = Buffer.from(config.getOrThrow<string>('argon2.pepper'));
  }

  private static readonly OPTIONS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      ...PasswordService.OPTIONS,
      secret: this.pepper,
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain, { secret: this.pepper });
    } catch {
      // A malformed stored hash must read as "wrong password",
      // never as a 500 that tells an attacker something.
      return false;
    }
  }
}
