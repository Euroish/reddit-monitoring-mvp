import { backupDatabase, restoreDatabase } from './database-backup-lib.mjs';
const option = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
async function main() {
  const mode = process.argv[2], file = option('--file');
  if (!['backup', 'restore'].includes(mode) || !file) throw new Error('Usage: database-backup.mjs backup|restore --file output/backups/name.dump [--target fresh_restore_database]');
  if (!process.env.DATABASE_URL || !process.env.PG_BIN) throw new Error('Set private DATABASE_URL and PG_BIN; credentials are not printed');
  const options = { connectionString: process.env.DATABASE_URL, pgBin: process.env.PG_BIN, file };
  const result = mode === 'backup' ? await backupDatabase(options)
    : await restoreDatabase({ ...options, targetDatabase: option('--target') });
  console.log(JSON.stringify({ mode, ...result, originalDatabaseModified: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
