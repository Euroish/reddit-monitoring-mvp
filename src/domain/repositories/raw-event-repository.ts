import type { RawEnvelope } from "../../connectors/shared/connector.interface";

export interface RawEventRepository {
  append<TPayload>(event: {
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope<TPayload>;
  }): Promise<void>;
}

