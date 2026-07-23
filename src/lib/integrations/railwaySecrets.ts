import { IntegrationError } from "./errors";

/**
 * Railway secret-variable upsert, used only by the protected settings route.
 * Implemented in Pass 2 on top of the Railway API adapter.
 */
export async function setRailwaySecret(_params: {
  projectId: string;
  environmentId: string;
  serviceId?: string;
  name: string;
  value: string;
}): Promise<void> {
  throw new IntegrationError(
    "VALIDATION_ERROR",
    "Railway secret entry is not available yet (arrives with the Railway integration pass)."
  );
}
