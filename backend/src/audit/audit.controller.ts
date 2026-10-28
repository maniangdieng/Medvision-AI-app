import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators';
import { Role } from '../entities';
import { AuditService } from './audit.service';

@Controller('audit')
@Roles(Role.ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  liste(@Query('page') page = '1', @Query('action') action?: string) {
    return this.audit.liste(Math.max(1, parseInt(page, 10) || 1), 50, action || undefined);
  }
}
