module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.spec.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/',
  },
  clearMocks: true,
  // Add this line to help with potential transform issues if any JS files are in src/
  // transformIgnorePatterns: [
  //   '/node_modules/', // default
  //   '\.js$', // if you have js files in src that jest might try to transform with ts-jest
  // ],
};
