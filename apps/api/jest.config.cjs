module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  // Native ESM mode: the package is "type": "module" so .js is already ESM.
  // Run Jest with --experimental-vm-modules (set in the package.json scripts).
  transform: {},
  setupFiles: ['<rootDir>/tests/setupEnv.mjs'],
  clearMocks: true,
  // 60s: mongodb-memory-server may download its mongod binary on first run.
  testTimeout: 60000,
};
