import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({
    example: 'admin@example.com',
    description: 'Email address or 10-digit phone number',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  identifier: string;

  // A SHAPE, not a credential. This was the real seeded admin password,
  // and because Swagger copies examples verbatim it was published in
  // every generated document — including one the web app serves at a
  // URL that needs no token.
  @ApiProperty({ example: 'Str0ng!Passphrase', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
