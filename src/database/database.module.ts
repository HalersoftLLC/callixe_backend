import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EnvironmentVariables } from '../config/env.validation';
import { buildDataSourceOptions } from './typeorm.config';

// The ONLY place the database connection is created.
// forRootAsync registers one global DataSource (with its connection pool)
// that Nest shares across the whole app and closes on shutdown.
// Feature modules must use TypeOrmModule.forFeature([...]) — never forRoot again.
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        ...buildDataSourceOptions({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          DB_USERNAME: config.get('DB_USERNAME', { infer: true }),
          DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
          DB_NAME: config.get('DB_NAME', { infer: true }),
          DB_SSL: config.get('DB_SSL', { infer: true }),
          DB_CA_CERT: config.get('DB_CA_CERT', { infer: true }),
        }),
        // Entities registered with TypeOrmModule.forFeature() in each module
        // are picked up automatically; no global entity list to maintain.
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule implements OnModuleInit {
  private readonly logger = new Logger(DatabaseModule.name);

  // Injects the single shared DataSource; it does not create a new one.
  constructor(private readonly dataSource: DataSource) {}

  // Runs after TypeOrmModule has connected, so this confirms the connection.
  // Connection failures are already logged and retried by TypeOrmModule.
  onModuleInit(): void {
    if (!this.dataSource.isInitialized) {
      this.logger.error('Database connection is not initialized');
      return;
    }

    const { host, port, database } = this.dataSource.options as {
      host?: string;
      port?: number;
      database?: string;
    };
    // Never log the username or password.
    this.logger.log(
      `Connected to PostgreSQL database "${database}" at ${host}:${port}`,
    );
  }
}
