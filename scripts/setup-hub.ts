#!/usr/bin/env node
/**
 * Setup script to automatically create the Hub spreadsheet
 *
 * This script:
 * 1. Searches for the 3 master spreadsheets (Borrowers, Media, Loans)
 * 2. Validates all 3 exist (errors if any are missing)
 * 3. Creates a new Hub spreadsheet
 * 4. Creates the 3 required sheets (Borrowers, Media, Loans)
 * 5. Adds IMPORTRANGE formulas to pull data from master spreadsheets
 * 6. Outputs the Hub spreadsheet URL
 */

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface MasterSpreadsheet {
  name: string;
  id: string;
  lastModified: Date;
}

interface DiscoveredMasters {
  Borrowers?: MasterSpreadsheet;
  Media?: MasterSpreadsheet;
  Loans?: MasterSpreadsheet;
}

const REQUIRED_PREFIXES = {
  Borrowers: 'Borrowers',
  Media: 'Media',
  Loans: 'Loans',
} as const;

type SheetType = keyof typeof REQUIRED_PREFIXES;

/**
 * Load OAuth2 credentials from clasp
 */
async function getAuth() {
  const clasprcPath = join(homedir(), '.clasprc.json');

  if (!existsSync(clasprcPath)) {
    throw new Error(
      'Not authenticated with clasp. Please run: npx clasp login'
    );
  }

  const clasprc = JSON.parse(readFileSync(clasprcPath, 'utf8'));

  if (!clasprc.token || !clasprc.token.access_token) {
    throw new Error(
      'Invalid clasp credentials. Please run: npx clasp login'
    );
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: clasprc.token.access_token,
    refresh_token: clasprc.token.refresh_token,
    scope: clasprc.token.scope,
    token_type: clasprc.token.token_type,
    expiry_date: clasprc.token.expiry_date,
  });

  return oauth2Client;
}

/**
 * Search Drive for spreadsheets matching a prefix
 * Returns the most recently modified match
 */
async function findNewestSpreadsheetByPrefix(
  drive: any,
  prefix: string
): Promise<MasterSpreadsheet | null> {
  const query = `name contains '${prefix}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;

  try {
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
    });

    const files = response.data.files || [];

    // Filter to files that actually start with the prefix
    const matchingFiles = files.filter((file: any) =>
      file.name.startsWith(prefix)
    );

    if (matchingFiles.length === 0) {
      return null;
    }

    // Return the most recently modified
    const newest = matchingFiles[0];
    return {
      name: newest.name,
      id: newest.id,
      lastModified: new Date(newest.modifiedTime),
    };
  } catch (error) {
    console.error(`Error searching for spreadsheet with prefix "${prefix}":`, error);
    return null;
  }
}

/**
 * Discover all 3 master spreadsheets
 */
async function discoverMasterSpreadsheets(
  drive: any
): Promise<DiscoveredMasters> {
  console.log('🔍 Searching for master spreadsheets...\n');

  const discovered: DiscoveredMasters = {};

  for (const [sheetType, prefix] of Object.entries(REQUIRED_PREFIXES)) {
    const result = await findNewestSpreadsheetByPrefix(drive, prefix);

    if (result) {
      discovered[sheetType as SheetType] = result;
      console.log(`✓ Found ${sheetType}: "${result.name}" (ID: ${result.id})`);
    } else {
      console.log(`✗ Missing ${sheetType}: No spreadsheet found starting with "${prefix}"`);
    }
  }

  console.log('');
  return discovered;
}

/**
 * Validate that all 3 master spreadsheets were found
 */
function validateMasterSpreadsheets(discovered: DiscoveredMasters): void {
  const missing: string[] = [];

  for (const sheetType of Object.keys(REQUIRED_PREFIXES) as SheetType[]) {
    if (!discovered[sheetType]) {
      missing.push(sheetType);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `❌ Cannot create Hub spreadsheet. Missing master spreadsheet(s): ${missing.join(', ')}\n\n` +
      `Please create these spreadsheets in Google Drive first:\n` +
      missing.map(type => `  - Create a spreadsheet named "${REQUIRED_PREFIXES[type as SheetType]}" (or with that prefix)`).join('\n')
    );
  }

  console.log('✓ All 3 master spreadsheets found!\n');
}

/**
 * Create the Hub spreadsheet with 3 sheets and IMPORTRANGE formulas
 */
async function createHubSpreadsheet(
  sheets: any,
  discovered: DiscoveredMasters
): Promise<string> {
  console.log('📊 Creating Hub spreadsheet...\n');

  // Create the spreadsheet
  const createResponse = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: 'Library Hub',
      },
      sheets: [
        { properties: { title: 'Borrowers', index: 0 } },
        { properties: { title: 'Media', index: 1 } },
        { properties: { title: 'Loans', index: 2 } },
      ],
    },
  });

  const spreadsheetId = createResponse.data.spreadsheetId;
  const spreadsheetUrl = createResponse.data.spreadsheetUrl;

  console.log(`✓ Created Hub spreadsheet: ${spreadsheetUrl}\n`);

  // Add IMPORTRANGE formulas to each sheet
  console.log('🔗 Adding IMPORTRANGE formulas...\n');

  const updates: any[] = [];

  for (const [index, sheetType] of (['Borrowers', 'Media', 'Loans'] as SheetType[]).entries()) {
    const masterId = discovered[sheetType]!.id;
    const formula = `=IMPORTRANGE("${masterId}", "Sheet1!A:G")`;

    updates.push({
      range: `${sheetType}!A1`,
      values: [[formula]],
    });

    console.log(`✓ ${sheetType}: =IMPORTRANGE("${masterId}", "Sheet1!A:G")`);
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updates,
    },
  });

  console.log('');
  return spreadsheetUrl!;
}

/**
 * Main setup function
 */
async function main() {
  console.log('🚀 Hub Spreadsheet Setup\n');
  console.log('=' .repeat(50) + '\n');

  try {
    // Authenticate
    const auth = await getAuth();
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // Discover master spreadsheets
    const discovered = await discoverMasterSpreadsheets(drive);

    // Validate all 3 are present
    validateMasterSpreadsheets(discovered);

    // Create Hub spreadsheet
    const hubUrl = await createHubSpreadsheet(sheets, discovered);

    console.log('=' .repeat(50));
    console.log('✅ Setup Complete!\n');
    console.log('Your Hub spreadsheet is ready:');
    console.log(`   ${hubUrl}\n`);
    console.log('Next steps:');
    console.log('  1. Open the Hub spreadsheet');
    console.log('  2. You may need to authorize IMPORTRANGE formulas');
    console.log('     (Click "Allow access" when prompted)');
    console.log('  3. Deploy your Apps Script code to the Hub:');
    console.log('     npm run push\n');

  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('An unexpected error occurred:', error);
    }
    process.exit(1);
  }
}

main();
