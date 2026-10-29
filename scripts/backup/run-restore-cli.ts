import fs from 'fs';
import path from 'path';
import '../../server/env.ts';
import { restoreDatabaseToTest, listAvailableBackups } from '../../server/services/backup.service.ts';
import { loadBackupConfig } from './config.ts';

async function main() {
  const config = loadBackupConfig();
  console.log(`\n======================================================`);
  console.log(` KAMCH ERP — Safe Database Restoration Utility (CLI) `);
  console.log(` Target Test Database: ${config.db.testDatabase}`);
  console.log(` Live Database (Protected): ${config.db.database}`);
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log(`======================================================\n`);

  // Parse arguments
  let targetFile = process.argv.find((arg) => arg.endsWith('.sql'));
  const targetDbArgIndex = process.argv.indexOf('--target-db');
  const targetDb = targetDbArgIndex !== -1 ? process.argv[targetDbArgIndex + 1] : config.db.testDatabase;
  const allowLive = process.argv.includes('--dangerously-allow-live-overwrite');

  if (!targetFile) {
    console.log(`No specific .sql backup file specified. Locating latest verified backup...`);
    const backups = listAvailableBackups();
    if (backups.length === 0) {
      console.error(`ERROR: No existing backup files found in ${config.destinations.internalDir}`);
      process.exit(1);
    }
    targetFile = backups[0].filePath;
    console.log(`Selected latest backup: ${backups[0].fileName} (${backups[0].sizeFormatted})`);
  }

  if (!fs.existsSync(targetFile)) {
    console.error(`ERROR: Backup file does not exist: ${targetFile}`);
    process.exit(1);
  }

  try {
    console.log(`Initiating safe test restoration to '${targetDb}'...`);
    const result = await restoreDatabaseToTest(targetFile, {
      targetDatabase: targetDb,
      allowOverwriteLive: allowLive,
    });

    console.log(`\nSUCCESS: Test restoration verified!`);
    console.log(`------------------------------------------------------`);
    console.log(` Restored Database : ${result.targetDatabase}`);
    console.log(` Source Backup File: ${result.sourceFile}`);
    console.log(` Tables Restored   : ${result.tablesRestored}`);
    console.log(` Sample Row Counts :`, result.sampleCounts);
    console.log(` Verified At       : ${result.restoredAt}`);
    console.log(`------------------------------------------------------\n`);
    process.exit(0);
  } catch (err) {
    console.error(`\nERROR: Restoration failed:`);
    console.error((err as Error).message);
    process.exit(1);
  }
}

void main();
