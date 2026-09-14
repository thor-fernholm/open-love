import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class GenerateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  prompt: string;

  /** Used as the folder name under generated-projects/ - keep it filesystem-safe. */
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9-_]{0,63}$/, {
    message:
      'projectName must be 1-64 characters of letters, digits, "-" or "_", starting with a letter or digit',
  })
  projectName: string;
}
