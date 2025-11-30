module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  moduleNameMapper: {
    '^(.*)\\.(css|less|scss)$': '<rootDir>/__mocks__/styleMock.js'
  },
  setupFiles: ['dotenv/config', '<rootDir>/src/integrations/agent_knowledge/__tests__/setup.env.setup.js']
};


