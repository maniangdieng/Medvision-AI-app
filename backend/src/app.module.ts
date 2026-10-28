import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai/ai.service';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './common/auth.guard';
import { ENTITIES } from './entities';
import { ExamsController } from './exams/exams.controller';
import { ExamsService } from './exams/exams.service';
import { MailService } from './mail/mail.service';
import { PatientsController } from './patients/patients.controller';
import { PdfService } from './reports/pdf.service';
import { StatsController } from './stats/stats.controller';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        type: 'postgres',
        url: c.getOrThrow<string>('DATABASE_URL'),
        ssl: c.get('DATABASE_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        entities: ENTITIES,
        // crée/maj les tables automatiquement — mettre DB_SYNC=false une fois en production stable
        synchronize: c.get('DB_SYNC', 'true') === 'true',
      }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (c: ConfigService) => {
        const secret = c.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 32) throw new Error('JWT_SECRET doit faire au moins 32 caractères');
        return { secret, signOptions: { expiresIn: '15m', issuer: 'medvision' }, verifyOptions: { issuer: 'medvision' } };
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
  ],
  controllers: [AuthController, UsersController, PatientsController, ExamsController, AuditController, StatsController],
  providers: [
    AuthService, AuditService, AiService, ExamsService, MailService, PdfService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
