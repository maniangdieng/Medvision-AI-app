import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email invalide' }) @MaxLength(160) email!: string;
  @IsString() @MinLength(1) @MaxLength(200) motDePasse!: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(200) ancienMotDePasse!: string;
  @IsString() @MinLength(10) @MaxLength(200) nouveauMotDePasse!: string;
}
