import { Body, Controller, Get, Put } from '@nestjs/common';
import type { AgentSelection } from '../project-generator/project.types';
import { AgentSelectionDto } from './dto/agent-selection.dto';
import { SettingsService, type OllamaModelsResult } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  getDefault(): AgentSelection {
    return this.settings.getDefault();
  }

  @Put()
  setDefault(@Body() dto: AgentSelectionDto): AgentSelection {
    return this.settings.setDefault(dto);
  }

  @Get('ollama/models')
  listOllamaModels(): Promise<OllamaModelsResult> {
    return this.settings.listOllamaModels();
  }
}
