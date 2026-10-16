export interface ManagedLocalConfig { pgBin: string; pgData: string; pgPort: number; apiPort: number; webPort: number; databaseUrl: string; setupComplete: boolean }
export function validateManagedConfig(value: unknown, home: string): ManagedLocalConfig;
export function managedEnvironment(config: ManagedLocalConfig, values: Record<string, string | undefined>, shell?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
