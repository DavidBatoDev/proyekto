import { Controller, Get, Param } from '@nestjs/common';
import { ConsultantsService } from './consultants.service';
import { Public } from '../../common/decorators/public.decorator';
import { SetCachePolicy } from '../../common/decorators/cache-policy.decorator';
import { CACHE_POLICY_PRESETS } from '../../common/cache/cache-policy';

@Controller('consultants')
export class ConsultantsController {
  constructor(private readonly consultantsService: ConsultantsService) {}

  @Get()
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  findAll() {
    return this.consultantsService.findAll();
  }

  @Get(':id')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  findOne(@Param('id') id: string) {
    return this.consultantsService.findOne(id);
  }
}
