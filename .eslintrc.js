module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2019,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    jest: true,
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  globals: {
    // Google Apps Script globals
    SpreadsheetApp: 'readonly',
    DriveApp: 'readonly',
    PropertiesService: 'readonly',
    HtmlService: 'readonly',
    Session: 'readonly',
    Logger: 'readonly',
    Utilities: 'readonly',
  },
};
