import type { RawEnvelope } from "../../connectors/shared/connector.interface";

export type RawEventRetentionReason =
  | "debug"
  | "http_error"
  | "normalization_failure"
  | "empty_response"
  | "provider_diff"
  | "sample";

export interface RawEventRepository {
  append<TPayload>(event: {
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope<TPayload>;
    retention?: {
      retainRawPayload?: boolean;
      reason?: RawEventRetentionReason;
    };
  }): Promise<void>;
}
