import { Client, type Pool, type PoolClient } from "pg";

const CHANNEL_RE = /^[a-z][a-z0-9_]{0,62}$/;

export function assertValidChannel(channel: string): string {
  if (!CHANNEL_RE.test(channel)) {
    throw new Error(`Invalid PostgreSQL notification channel: ${channel}`);
  }
  return channel;
}

export async function notifyChannel(db: Pool | PoolClient, channel: string): Promise<void> {
  const safeChannel = assertValidChannel(channel);
  await db.query("SELECT pg_notify($1, '')", [safeChannel]).catch(() => {});
}

export function createPgNotifier(
  connectionString: string | undefined,
  channel: string,
  onNotify: () => void,
  onError?: (error: unknown) => void,
): { close: () => Promise<void> } {
  const safeChannel = assertValidChannel(channel);
  if (!connectionString) return { close: async () => {} };

  let closed = false;
  let client: Client | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 1000;

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(15_000, backoffMs * 2);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
    reconnectTimer.unref();
  };

  async function connect(): Promise<void> {
    if (closed) return;
    const next = new Client({ connectionString });
    client = next;
    next.on("notification", (msg) => {
      if (msg.channel === safeChannel) onNotify();
    });
    next.on("error", (err) => {
      onError?.(err);
      if (client === next) {
        client = null;
        void next.end().catch(() => {});
        if (!closed) scheduleReconnect();
      }
    });
    next.on("end", () => {
      if (client === next) client = null;
      if (!closed) scheduleReconnect();
    });
    try {
      await next.connect();
      if (closed) {
        await next.end().catch(() => {});
        return;
      }
      await next.query(`LISTEN ${safeChannel}`);
      backoffMs = 1000;
      onNotify();
    } catch (err) {
      onError?.(err);
      await next.end().catch(() => {});
      if (client === next) client = null;
      if (!closed) scheduleReconnect();
    }
  }

  void connect();
  return {
    close: async () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const active = client;
      client = null;
      if (active) await active.end().catch(() => {});
    },
  };
}
