import { variableUpsert } from "./railway";

/**
 * Railway secret-variable upsert, used only by the protected settings route
 * (/api/integrations/secrets). The value travels UI → server → Railway API
 * request body; it is never present in chat, tool results, audit rows, or
 * logs.
 */
export async function setRailwaySecret(params: {
  projectId: string;
  environmentId: string;
  serviceId?: string;
  name: string;
  value: string;
}): Promise<void> {
  await variableUpsert(params);
}
