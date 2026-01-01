/**
 * Base service with common CRUD operations for spreadsheet entities
 */

import { OperationResult, SheetName } from '../types';
import { openMasterSpreadsheet } from './discovery';

/**
 * Generic interface for entities with an ID
 */
interface Entity {
  id: string;
}

/**
 * Base service class for entity CRUD operations
 */
class BaseEntityService<T extends Entity> {
  protected sheetName: SheetName;
  protected columns: (keyof T)[];

  constructor(sheetName: SheetName, columns: (keyof T)[]) {
    this.sheetName = sheetName;
    this.columns = columns;
  }

  /**
   * Gets the master spreadsheet for this entity type
   */
  protected getMasterSheet(): GoogleAppsScript.Spreadsheet.Sheet | null {
    const spreadsheet = openMasterSpreadsheet(this.sheetName);
    if (!spreadsheet) {
      return null;
    }

    // Assume data is on the first sheet of the master spreadsheet
    const sheets = spreadsheet.getSheets();
    return sheets.length > 0 ? sheets[0] : null;
  }

  /**
   * Gets all entities from the master sheet
   */
  getAll(): OperationResult<T[]> {
    const sheet = this.getMasterSheet();
    if (!sheet) {
      return {
        success: false,
        error: `Could not access ${this.sheetName} master spreadsheet. Run Setup first.`,
      };
    }

    const data = sheet.getDataRange().getValues();
    console.log(`Found ${data.length} rows of data`);
    if (data.length <= 1) {
      return { success: true, data: [] };
    }

    const entities: T[] = [];
    // Skip header row
    console.log(this.columns)
    for (let i = 1; i < data.length; i++) {
      const entity = this.rowToEntity(data[i]);
      console.log(`Found entity: ${entity}`);
      if (entity) {
        entities.push(entity);
      }
    }

    return { success: true, data: entities };
  }

  /**
   * Gets a single entity by ID
   */
  getById(id: string): OperationResult<T> {
    const sheet = this.getMasterSheet();
    if (!sheet) {
      return {
        success: false,
        error: `Could not access ${this.sheetName} master spreadsheet. Run Setup first.`,
      };
    }

    const data = sheet.getDataRange().getValues();

    // Find the row with matching ID (ID is assumed to be first column)
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === id) {
        const entity = this.rowToEntity(data[i]);
        if (entity) {
          return { success: true, data: entity };
        }
      }
    }

    return { success: false, error: `${this.sheetName} with ID ${id} not found` };
  }

  /**
   * Creates a new entity
   */
  create(entity: Omit<T, 'id'>): OperationResult<T> {
    const sheet = this.getMasterSheet();
    if (!sheet) {
      return {
        success: false,
        error: `Could not access ${this.sheetName} master spreadsheet. Run Setup first.`,
      };
    }

    // Generate a new ID
    const newId = this.generateId();
    const fullEntity = { id: newId, ...entity } as T;

    // Append the row
    const row = this.entityToRow(fullEntity);
    sheet.appendRow(row);

    return { success: true, data: fullEntity };
  }

  /**
   * Updates an existing entity
   */
  update(id: string, updates: Partial<Omit<T, 'id'>>): OperationResult<T> {
    const sheet = this.getMasterSheet();
    if (!sheet) {
      return {
        success: false,
        error: `Could not access ${this.sheetName} master spreadsheet. Run Setup first.`,
      };
    }

    const data = sheet.getDataRange().getValues();

    // Find the row with matching ID
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === id) {
        const existingEntity = this.rowToEntity(data[i]);
        if (!existingEntity) {
          return { success: false, error: 'Failed to parse existing entity' };
        }

        // Merge updates
        const updatedEntity = { ...existingEntity, ...updates, id } as T;
        const row = this.entityToRow(updatedEntity);

        // Update the row (i+1 because sheet rows are 1-indexed)
        const range = sheet.getRange(i + 1, 1, 1, row.length);
        range.setValues([row]);

        return { success: true, data: updatedEntity };
      }
    }

    return { success: false, error: `${this.sheetName} with ID ${id} not found` };
  }

  /**
   * Deletes an entity by ID
   */
  delete(id: string): OperationResult {
    const sheet = this.getMasterSheet();
    if (!sheet) {
      return {
        success: false,
        error: `Could not access ${this.sheetName} master spreadsheet. Run Setup first.`,
      };
    }

    const data = sheet.getDataRange().getValues();

    // Find the row with matching ID
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === id) {
        // Delete the row (i+1 because sheet rows are 1-indexed)
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }

    return { success: false, error: `${this.sheetName} with ID ${id} not found` };
  }

  /**
   * Converts a spreadsheet row to an entity object
   */
  protected rowToEntity(row: unknown[]): T | null {
    if (row.length < this.columns.length) {
      return null;
    }

    const entity: Record<string, unknown> = {};
    for (let i = 0; i < this.columns.length; i++) {
      entity[this.columns[i] as string] = row[i];
    }

    return entity as T;
  }

  /**
   * Converts an entity object to a spreadsheet row
   */
  protected entityToRow(entity: T): unknown[] {
    return this.columns.map((col) => entity[col] ?? '');
  }

  /**
   * Generates a unique ID for a new entity
   */
  protected generateId(): string {
    return Utilities.getUuid();
  }

  /**
   * Ensures the master sheet has headers
   */
  ensureHeaders(): OperationResult {
    const sheet = this.getMasterSheet();
    if (!sheet) {
      return {
        success: false,
        error: `Could not access ${this.sheetName} master spreadsheet. Run Setup first.`,
      };
    }

    const data = sheet.getDataRange().getValues();

    // Check if first row matches expected headers
    const expectedHeaders = this.columns.map((col) => String(col));

    if (data.length === 0) {
      // Empty sheet, add headers
      sheet.appendRow(expectedHeaders);
      return { success: true };
    }

    // Check if headers match
    const currentHeaders = data[0].map((h) => String(h));
    const headersMatch = expectedHeaders.every((h, i) => currentHeaders[i] === h);

    if (!headersMatch) {
      // Insert headers at top
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    }

    return { success: true };
  }
}

export { BaseEntityService, Entity };
