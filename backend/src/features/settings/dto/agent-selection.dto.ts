import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AgentSelectionDto {
  @IsIn(['claude', 'ollama'])
  provider: 'claude' | 'ollama';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;
}
