/**
 * Minimal in-memory Prisma stand-in covering exactly what the integration
 * layer touches: integrationLog + pendingAction.
 */

let cuidCounter = 0;
const cuid = () => `fake_${++cuidCounter}_${Math.random().toString(36).slice(2, 8)}`;

export interface FakeDb {
  integrationLog: {
    rows: Array<Record<string, unknown>>;
    create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    findMany: () => Promise<Array<Record<string, unknown>>>;
  };
  pendingAction: {
    rows: Array<Record<string, unknown> & { id: string; consumedAt: Date | null; expiresAt: Date }>;
    create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
    updateMany: (args: {
      where: { id: string; consumedAt: null };
      data: { consumedAt: Date };
    }) => Promise<{ count: number }>;
  };
  reset: () => void;
}

export function createFakeDb(): FakeDb {
  const db: FakeDb = {
    integrationLog: {
      rows: [],
      async create({ data }) {
        const row = { id: cuid(), createdAt: new Date(), ...data };
        db.integrationLog.rows.push(row);
        return row;
      },
      async findMany() {
        return db.integrationLog.rows;
      },
    },
    pendingAction: {
      rows: [],
      async create({ data }) {
        const row = {
          id: cuid(),
          createdAt: new Date(),
          consumedAt: null as Date | null,
          ...data,
        } as unknown as FakeDb["pendingAction"]["rows"][number];
        db.pendingAction.rows.push(row);
        return row;
      },
      async findUnique({ where }) {
        return db.pendingAction.rows.find((r) => r.id === where.id) ?? null;
      },
      async updateMany({ where, data }) {
        const row = db.pendingAction.rows.find(
          (r) => r.id === where.id && r.consumedAt === null
        );
        if (!row) return { count: 0 };
        row.consumedAt = data.consumedAt;
        return { count: 1 };
      },
    },
    reset() {
      db.integrationLog.rows.length = 0;
      db.pendingAction.rows.length = 0;
    },
  };
  return db;
}
