import { Environment } from '../config/env.validation';
import { buildDataSourceOptions, DatabaseEnv } from './typeorm.config';

const baseEnv: DatabaseEnv = {
  NODE_ENV: Environment.Production,
  DB_HOST: 'db.example.com',
  DB_PORT: 25060,
  DB_USERNAME: 'app',
  DB_PASSWORD: 'secret',
  DB_NAME: 'callixe',
  DB_SSL: false,
};

const pem = '-----BEGIN CERTIFICATE-----\nMIIEQTCC\n-----END CERTIFICATE-----';

describe('buildDataSourceOptions', () => {
  it('connects without SSL when DB_SSL is false', () => {
    expect(buildDataSourceOptions(baseEnv).ssl).toBe(false);
  });

  it('verifies the server certificate with SSL and no CA (public CA)', () => {
    const { ssl } = buildDataSourceOptions({ ...baseEnv, DB_SSL: true });
    expect(ssl).toEqual({ rejectUnauthorized: true });
  });

  it('trusts the given CA and still verifies the certificate', () => {
    const { ssl } = buildDataSourceOptions({
      ...baseEnv,
      DB_SSL: true,
      DB_CA_CERT: pem,
    });
    expect(ssl).toEqual({ rejectUnauthorized: true, ca: pem });
  });

  it('never uses synchronize or runs migrations on start', () => {
    const options = buildDataSourceOptions(baseEnv);
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
  });
});
