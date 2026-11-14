// Test-only CommonJS copy of @nestjs/typeorm's dist/common/typeorm-compat.js.
// The original uses `import.meta.url` + createRequire, which only work in a
// real ES module, so Jest (on Node below 24.9) cannot convert it. It is
// swapped in through `moduleNameMapper` in package.json. Same behaviour:
// read the optional TypeORM 0.3 exports, undefined on TypeORM 1.x.
// Never used by the running app.

function resolveTypeormExport(exportName) {
  try {
    return require('typeorm')[exportName];
  } catch {
    return undefined;
  }
}

module.exports = {
  Connection: resolveTypeormExport('Connection'),
  AbstractRepository: resolveTypeormExport('AbstractRepository'),
};
