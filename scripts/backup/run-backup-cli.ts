import '../../server/env.ts';
import { createDatabaseBackup } from '../../server/services/backup.service.ts';
import { formatBytes } from './crypto-utils.ts';

async function main() {
  const isWeekly = process.argv.includes('--weekly');
  const type = isWeekly ? 'weekly' : 'daily';

  console.log(`\n======================================================`);
  console.log(` KAMCH ERP — Database Backup Engine (CLI Launcher) `);
  console.log(` Mode: ${type.toUpperCase()}`);
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log(`======================================================\n`);

  try {
    const result = await createDatabaseBackup({
      type,
      triggeredBy: 'CLI',
      isManual: true,
    });

    console.log(`\nSUCCESS: Backup created and verified successfully!`);
    console.log(`------------------------------------------------------`);
    console.log(` File Name    : ${result.fileName}`);
    console.log(` File Path    : ${result.filePath}`);
    console.log(` File Size    : ${formatBytes(result.fileSizeBytes)}`);
    console.log(` SHA-256 Hash : ${result.sha256}`);
    console.log(` Tables Dumped: ${result.tableCount}`);
    if (result.usbCopied) {
      console.log(` USB Copy     : Verified on ${result.usbPath}`);
    }
    console.log(`------------------------------------------------------\n`);
    process.exit(0);
  } catch (err) {
    console.error(`\nERROR: Database backup failed:`);
    console.error((err as Error).message);
    process.exit(1);
  }
}

void main();
