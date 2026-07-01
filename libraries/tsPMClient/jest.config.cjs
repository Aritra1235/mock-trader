module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  globals: {
    "ts-jest": {
      tsconfig: "tsconfig.json"
    }
  }
};
