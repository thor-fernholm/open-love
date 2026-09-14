import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class GenerateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  prompt: string;

  /**
   * User-facing display name for a brand-new project. Required only when
   * `projectId` is absent - enforced in the service, since that's a
   * conditional requirement class-validator can't express directly on a
   * single field.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  /**
   * Set on a follow-up prompt into an already-generated project. This is a
   * server-issued id (see ProjectGeneratorService.start), never something
   * the client invents - still validated defensively before use as a path
   * segment.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9-]{1,100}$/, {
    message: 'projectId must be an id previously returned by this API',
  })
  projectId?: string;

  /**
   * Per-message override of which agent builds this turn. Omitted = fall
   * back to the project's most recent turn, or the persisted global
   * default (see features/settings) if there isn't one yet.
   */
  @IsOptional()
  @IsIn(['claude', 'ollama'])
  provider?: 'claude' | 'ollama';

  /** Required alongside provider: 'ollama' (which local model); ignored otherwise. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;
}
