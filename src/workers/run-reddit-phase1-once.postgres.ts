import { runPhase1OnceWithPostgres } from "../../workers/reddit-phase1-once";

async function main(): Promise<void> {
  const result = await runPhase1OnceWithPostgres();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

void main();
