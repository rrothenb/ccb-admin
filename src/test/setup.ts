/**
 * Jest setup file - mocks Google Apps Script globals
 */

// Mock SpreadsheetApp
const mockSpreadsheetApp = {
  getActiveSpreadsheet: jest.fn(),
  getActiveSheet: jest.fn(),
  openById: jest.fn(),
  getUi: jest.fn(() => ({
    createMenu: jest.fn(() => ({
      addItem: jest.fn().mockReturnThis(),
      addSeparator: jest.fn().mockReturnThis(),
      addSubMenu: jest.fn().mockReturnThis(),
      addToUi: jest.fn(),
    })),
    showSidebar: jest.fn(),
    showModalDialog: jest.fn(),
    alert: jest.fn(),
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
  })),
};

// Mock DriveApp
const mockDriveApp = {
  searchFiles: jest.fn(() => ({
    hasNext: jest.fn().mockReturnValue(false),
    next: jest.fn(),
  })),
  getFileById: jest.fn(),
};

// Mock PropertiesService
const mockPropertiesService = {
  getScriptProperties: jest.fn(() => ({
    getProperty: jest.fn(),
    setProperty: jest.fn(),
    deleteProperty: jest.fn(),
    getProperties: jest.fn(() => ({})),
    setProperties: jest.fn(),
  })),
  getUserProperties: jest.fn(() => ({
    getProperty: jest.fn(),
    setProperty: jest.fn(),
    deleteProperty: jest.fn(),
    getProperties: jest.fn(() => ({})),
    setProperties: jest.fn(),
  })),
};

// Mock HtmlService
const mockHtmlService = {
  createHtmlOutput: jest.fn(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setWidth: jest.fn().mockReturnThis(),
    getContent: jest.fn(),
  })),
  createHtmlOutputFromFile: jest.fn(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setWidth: jest.fn().mockReturnThis(),
    getContent: jest.fn(),
  })),
  createTemplateFromFile: jest.fn(() => ({
    evaluate: jest.fn(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setWidth: jest.fn().mockReturnThis(),
      getContent: jest.fn(),
    })),
  })),
};

// Mock Session
const mockSession = {
  getActiveUser: jest.fn(() => ({
    getEmail: jest.fn(() => 'test@example.com'),
  })),
  getEffectiveUser: jest.fn(() => ({
    getEmail: jest.fn(() => 'test@example.com'),
  })),
};

// Mock Logger
const mockLogger = {
  log: jest.fn(),
  clear: jest.fn(),
  getLog: jest.fn(() => ''),
};

// Mock Utilities
const mockUtilities = {
  getUuid: jest.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9)),
  formatDate: jest.fn((date, _tz, format) => {
    if (format === 'yyyy-MM-dd') {
      return date.toISOString().split('T')[0];
    }
    return date.toISOString();
  }),
};

// Assign mocks to global scope
(global as Record<string, unknown>).SpreadsheetApp = mockSpreadsheetApp;
(global as Record<string, unknown>).DriveApp = mockDriveApp;
(global as Record<string, unknown>).PropertiesService = mockPropertiesService;
(global as Record<string, unknown>).HtmlService = mockHtmlService;
(global as Record<string, unknown>).Session = mockSession;
(global as Record<string, unknown>).Logger = mockLogger;
(global as Record<string, unknown>).Utilities = mockUtilities;

// Export mocks for use in tests
export {
  mockSpreadsheetApp,
  mockDriveApp,
  mockPropertiesService,
  mockHtmlService,
  mockSession,
  mockLogger,
  mockUtilities,
};
