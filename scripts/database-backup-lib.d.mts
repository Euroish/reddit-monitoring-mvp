import type { Client } from "pg";
export interface DatabaseInventory { tables: Record<string, number>; migrations: { filename: string; checksum: string }[] }
export function backupFile(root: string, file: string): string;
export function databaseEnvironment(connectionString: string, shell?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function restoreDatabaseName(value: string): string;
export function databaseInventory(client: Client): Promise<DatabaseInventory>;
export function compareInventory(expected: DatabaseInventory, actual: DatabaseInventory): true;
export function backupDatabase(options: { root?: string; connectionString: string; pgBin: string; file: string }): Promise<{ file: string; manifestPath: string; sha256: string; tableCount: number }>;
export function restoreDatabase(options: { root?: string; connectionString: string; pgBin: string; file: string; targetDatabase: string }): Promise<{ database: string; archiveSha256: string; inventoryMatches: true; acceptance: string; businessAcceptanceRequired: true }>;
