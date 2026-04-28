import type { Account } from "../../../domain/entities/account";
import type { Content } from "../../../domain/entities/content";
import type { PostSearchDocument } from "../../../domain/entities/post-search-document";
import type { AccountRepository } from "../../../domain/repositories/account-repository";
import type { ContentRepository } from "../../../domain/repositories/content-repository";
import type { PostSearchDocumentRepository } from "../../../domain/repositories/post-search-document-repository";

export class InMemoryAccountRepository implements AccountRepository {
  private readonly byExternalId = new Map<string, Account>();

  public async upsertMany(accounts: Account[]): Promise<void> {
    for (const account of accounts) {
      this.byExternalId.set(account.externalId, account);
    }
  }

  public async findByExternalId(externalId: string): Promise<Account | null> {
    return this.byExternalId.get(externalId) ?? null;
  }

  public all(): Account[] {
    return Array.from(this.byExternalId.values());
  }
}

export class InMemoryContentRepository implements ContentRepository {
  private readonly byExternalId = new Map<string, Content>();

  public async upsertMany(contents: Content[]): Promise<void> {
    for (const content of contents) {
      const current = this.byExternalId.get(content.externalId);
      this.byExternalId.set(content.externalId, {
        ...content,
        firstSeenAt:
          current && current.firstSeenAt < content.firstSeenAt
            ? current.firstSeenAt
            : content.firstSeenAt,
        lastSeenAt:
          current && current.lastSeenAt > content.lastSeenAt
            ? current.lastSeenAt
            : content.lastSeenAt,
        discoverySource: current?.discoverySource ?? content.discoverySource ?? "new_listing",
        firstCollectionMode: current?.firstCollectionMode ?? content.firstCollectionMode,
        firstListing: current?.firstListing ?? content.firstListing,
        firstTimeRange: current?.firstTimeRange ?? content.firstTimeRange,
        firstCollectionJobId: current?.firstCollectionJobId ?? content.firstCollectionJobId,
        totalEligible: current
          ? (current.totalEligible ?? true) || (content.totalEligible ?? true)
          : content.totalEligible ?? true,
      });
    }
  }

  public async countExistingExternalIds(args: {
    targetId: string;
    externalIds: string[];
  }): Promise<number> {
    const existingExternalIds = await this.findExistingExternalIds(args);
    return existingExternalIds.length;
  }

  public async findExistingExternalIds(args: {
    targetId: string;
    externalIds: string[];
  }): Promise<string[]> {
    if (args.externalIds.length === 0) {
      return [];
    }
    const existing: string[] = [];
    for (const externalId of new Set(args.externalIds)) {
      const current = this.byExternalId.get(externalId);
      if (current && current.targetId === args.targetId) {
        existing.push(externalId);
      }
    }
    return existing;
  }

  public async findRecentByTarget(targetId: string, limit: number): Promise<Content[]> {
    return Array.from(this.byExternalId.values())
      .filter((content) => content.targetId === targetId)
      .sort((a, b) => b.createdAtSource.localeCompare(a.createdAtSource))
      .slice(0, limit);
  }

  public async findByTargetCreatedAtRange(args: {
    targetId: string;
    from: string;
    to: string;
    limit?: number;
    totalEligibleOnly?: boolean;
  }): Promise<Content[]> {
    return Array.from(this.byExternalId.values())
      .filter((content) => {
        return (
          content.targetId === args.targetId &&
          content.createdAtSource >= args.from &&
          content.createdAtSource <= args.to &&
          (!args.totalEligibleOnly || (content.totalEligible ?? true))
        );
      })
      .sort((a, b) => a.createdAtSource.localeCompare(b.createdAtSource))
      .slice(0, args.limit ?? 5000);
  }

  public all(): Content[] {
    return Array.from(this.byExternalId.values());
  }
}

export class InMemoryPostSearchDocumentRepository implements PostSearchDocumentRepository {
  private readonly byContentId = new Map<string, PostSearchDocument>();

  public async upsertMany(rows: PostSearchDocument[]): Promise<void> {
    for (const row of rows) {
      this.byContentId.set(row.contentId, row);
    }
  }

  public async seedFromContent(_limit: number): Promise<number> {
    return 0;
  }

  public async countByScope(args: { canonicalSubreddit?: string }): Promise<number> {
    if (!args.canonicalSubreddit) {
      return this.byContentId.size;
    }
    let count = 0;
    for (const row of this.byContentId.values()) {
      if (row.canonicalSubreddit === args.canonicalSubreddit) {
        count += 1;
      }
    }
    return count;
  }

  public async search(args: {
    tokens: string[];
    canonicalSubreddit?: string;
    limit: number;
    createdAtFrom?: string;
    createdAtTo?: string;
  }): Promise<PostSearchDocument[]> {
    const normalizedTokens = args.tokens.map((token) => token.toLowerCase());
    return Array.from(this.byContentId.values())
      .filter((row) => {
        if (args.canonicalSubreddit && row.canonicalSubreddit !== args.canonicalSubreddit) {
          return false;
        }
        if (args.createdAtFrom && row.createdAtSource < args.createdAtFrom) {
          return false;
        }
        if (args.createdAtTo && row.createdAtSource >= args.createdAtTo) {
          return false;
        }
        const haystack = `${row.title} ${row.bodySnippet ?? ""}`.toLowerCase();
        return normalizedTokens.some((token) => haystack.includes(token));
      })
      .map((row) => {
        const haystack = `${row.title} ${row.bodySnippet ?? ""}`.toLowerCase();
        let score = 0;
        for (const token of normalizedTokens) {
          if (haystack.includes(token)) {
            score += 1;
          }
        }
        return { ...row, matchScore: score };
      })
      .sort((a, b) => {
        const byScore = (b.matchScore ?? 0) - (a.matchScore ?? 0);
        if (byScore !== 0) {
          return byScore;
        }
        return b.createdAtSource.localeCompare(a.createdAtSource);
      })
      .slice(0, args.limit);
  }
}
