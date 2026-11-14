import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.validation';
import { buildDataSourceOptions } from './typeorm.config';

// Used ONLY by the TypeORM CLI (migration:generate / run / revert / show).
// The running app gets its single connection from DatabaseModule.
// Never import this file into application code.

// Same env file selection as ConfigModule in app.module.ts.
// Variables already set in the real environment are not overwritten.
const envFile = `.env.${process.env.NODE_ENV ?? 'development'}`;
if (existsSync(envFile)) loadEnvFile(envFile);

const env = validateEnv(process.env);

// Run from src/ via ts-node in development, or from dist/ as compiled JS in
// production. Only match the matching extension so .d.ts files are skipped.
const ext = __filename.endsWith('.ts') ? 'ts' : 'js';
const dir = __dirname.replace(/\\/g, '/');

export default new DataSource({
  ...buildDataSourceOptions(env),
  entities: [`${dir}/../**/*.entity.${ext}`],
  migrations: [`${dir}/migrations/*.${ext}`],
});
