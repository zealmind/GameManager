module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverage: false,
  verbose: true,
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: false }],
  },
  moduleNameMapper: {
    '^@libsql/client$': '<rootDir>/src/__mocks__/@libsql/client.js'
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        module: 'commonjs',
        esModuleInterop: true,
      },
    },
  },
};