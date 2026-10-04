// Builds the NestJS application on Fastify (ADR-0021). Used by main.ts and by
// the tests, so tests exercise exactly what runs in production.
import "reflect-metadata";
import { ENDPOINTS } from "@aestara/api-contracts";
import cors from "@fastify/cors";
import { type DynamicModule, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { DestinationStream, Logger } from "pino";
import { AuditController } from "./audit/audit.controller.ts";
import { AuditWriter } from "./audit/audit-writer.ts";
import { OfflineAuditService } from "./audit/offline-audit.service.ts";
import { AuthController } from "./auth/auth.controller.ts";
import { AuthService } from "./auth/auth.service.ts";
import { Catalog } from "./auth/catalog.ts";
import { CredentialsService } from "./auth/credentials.service.ts";
import { keyProviders } from "./auth/keys.provider.ts";
import { preloadPasswordList } from "./auth/passwords.ts";
import { SessionFactory } from "./auth/session-factory.ts";
import { SessionLoader } from "./auth/session-loader.ts";
import { AwsClients } from "./aws/clients.ts";
import { ErrorEnvelopeFilter, registerHttpHooks } from "./common/http.ts";
import { Idempotency } from "./common/idempotency.ts";
import { createLogger, NestPinoLogger } from "./common/logging.ts";
import { BOUND_OPERATIONS } from "./common/operation.ts";
import { OperationPipeline } from "./common/pipeline.ts";
import { CONFIG, type Config } from "./config.ts";
import { ConsultationsController } from "./consultations/consultations.controller.ts";
import { ConsultationsService } from "./consultations/consultations.service.ts";
import { HistoryService } from "./consultations/history.service.ts";
import { NotesService } from "./consultations/notes.service.ts";
import { Database } from "./db/database.ts";
import { EmailService } from "./email/email.ts";
import { HealthController } from "./health/health.controller.ts";
import { ObjectStore } from "./media/object-store.ts";
import { OrganizationsController } from "./organizations/organizations.controller.ts";
import { OrganizationsService } from "./organizations/organizations.service.ts";
import { Outbox } from "./outbox/outbox.ts";
import { PatientsController } from "./patients/patients.controller.ts";
import { PatientsService } from "./patients/patients.service.ts";
import { PhotoIntake } from "./photos/intake.ts";
import { PermissionLedger } from "./photos/permission-ledger.ts";
import { PermissionsService } from "./photos/permissions.service.ts";
import { PhotographyController } from "./photos/photography.controller.ts";
import { PhotosService } from "./photos/photos.service.ts";
import { ProtocolsService } from "./photos/protocols.service.ts";
import { ConfigurationController } from "./settings/configuration.controller.ts";
import { ConfigurationService } from "./settings/configuration.service.ts";
import { SettingsController } from "./settings/settings.controller.ts";
import { RolesController } from "./users/roles.controller.ts";
import { UsersController } from "./users/users.controller.ts";
import { UsersService } from "./users/users.service.ts";

@Module({})
class AppModule {
  static register(config: Config): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        HealthController,
        OrganizationsController,
        UsersController,
        RolesController,
        PatientsController,
        AuditController,
        SettingsController,
        PhotographyController,
        ConsultationsController,
        ConfigurationController,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        ...keyProviders,
        Database,
        Catalog,
        AuditWriter,
        EmailService,
        Idempotency,
        SessionLoader,
        SessionFactory,
        AuthService,
        CredentialsService,
        OrganizationsService,
        UsersService,
        PatientsService,
        AwsClients,
        ObjectStore,
        Outbox,
        PhotoIntake,
        ProtocolsService,
        PhotosService,
        PermissionLedger,
        PermissionsService,
        ConsultationsService,
        NotesService,
        HistoryService,
        ConfigurationService,
        OfflineAuditService,
        OperationPipeline,
      ],
    };
  }
}

/** Every registry operation has exactly one route, and every route is in the registry. */
export function checkRouteTable(): void {
  const expected = new Set<string>(ENDPOINTS.map((e) => e.operationId));
  const missing = [...expected].filter((id) => !BOUND_OPERATIONS.has(id));
  const extra = [...BOUND_OPERATIONS.keys()].filter((id) => !expected.has(id));
  const duplicated = [...BOUND_OPERATIONS.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (missing.length + extra.length + duplicated.length > 0)
    throw new Error(
      `Route table differs from the endpoint registry: missing [${missing}], extra [${extra}], duplicated [${duplicated}]`,
    );
}

export interface CreatedApp {
  readonly app: NestFastifyApplication;
  readonly logger: Logger;
}

export async function createApp(
  config: Config,
  options: { logDestination?: DestinationStream } = {},
): Promise<CreatedApp> {
  checkRouteTable();
  preloadPasswordList();
  const logger = createLogger(config, options.logDestination);
  const adapter = new FastifyAdapter({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    return503OnClosing: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(config), adapter, {
    logger: new NestPinoLogger(logger),
    abortOnError: false,
  });
  app.setGlobalPrefix("api/v1");
  const fastify = app.getHttpAdapter().getInstance();
  registerHttpHooks(fastify, config, logger);
  await app.register(cors, {
    origin: config.ADMIN_WEB_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "If-Match", "X-Client-Request-Id"],
    exposedHeaders: ["ETag", "X-Request-Id", "Retry-After"],
    maxAge: 600,
  });
  app.useGlobalFilters(new ErrorEnvelopeFilter(logger));
  app.useGlobalInterceptors(app.get(OperationPipeline));
  await app.init();
  await fastify.ready();
  return { app, logger };
}
