import { DataSourceOptions } from 'typeorm';
import { Environment, EnvironmentVariables } from '../config/env.validation';

type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

export type DatabaseEnv = Pick<
  EnvironmentVariables,
  | 'NODE_ENV'
  | 'DB_HOST'
  | 'DB_PORT'
  | 'DB_USERNAME'
  | 'DB_PASSWORD'
  | 'DB_NAME'
  | 'DB_SSL'
>;

// Single source of the PostgreSQL connection settings.
// Used by DatabaseModule (the running app) and data-source.ts (migration CLI)
// so both always connect the same way.
export function buildDataSourceOptions(env: DatabaseEnv): PostgresOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: env.DB_SSL ? { rejectUnauthorized: true } : false,

    // UUIDs come from PostgreSQL's built-in gen_random_uuid() (PG 13+).
    // Never try CREATE EXTENSION on connect: managed databases may refuse it.
    uuidExtension: 'pgcrypto',
    installExtensions: false,

    // Schema changes go through migrations only, run by a developer (CLAUDE.md 7.1).
    synchronize: false,
    migrationsRun: false,

    logging:
      env.NODE_ENV === Environment.Development
        ? ['query', 'error', 'warn']
        : ['error'],
  };
}
