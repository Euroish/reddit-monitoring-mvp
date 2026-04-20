import type { AppSessionRepository } from "../../domain/repositories/app-session-repository";

export async function logoutAppUser(args: {
  appSessionRepository: AppSessionRepository;
  tokenHash: string;
}): Promise<void> {
  await args.appSessionRepository.deleteByTokenHash(args.tokenHash);
}
