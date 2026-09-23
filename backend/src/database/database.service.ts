import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

const AFTER_COMMIT = Symbol('afterCommit');

/**
 * Run `fn` once whatever `queryable` is writing is visible to other
 * connections: after COMMIT for a transaction client from transaction(),
 * straight away for anything else. For side effects that tell someone to
 * re-read — fired before COMMIT, the re-read can land first and see nothing.
 * Never runs on ROLLBACK.
 */
export function afterCommit(queryable: unknown, fn: () => void): void {
  const hooks = (queryable as { [AFTER_COMMIT]?: Array<() => void> })?.[AFTER_COMMIT];
  if (hooks) hooks.push(fn);
  else fn();
}

/**
 * Thin wrapper around a pg Pool. No ORM, no query builder — every
 * query in this project is plain SQL, written and reviewed as SQL,
 * because the row-locking / constraint / trigger behavior the BRD
 * depends on (entitlement concurrency, template immutability, notes
 * isolation) needs to be exact, not generated.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.pool = new Pool({
      connectionString: this.config.get<string>('DATABASE_URL'),
    });

    this.pool.on('error', (err) => {
      // Handles idle-client errors (e.g. dropped connections) so a
      // single bad connection can't crash the whole process.
      this.logger.error('Unexpected error on idle Postgres client', err);
    });

    this.logger.log('PostgreSQL pool initialized');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /** Plain one-off query. Use this for anything that doesn't need a transaction. */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  /**
   * Runs `work` inside a BEGIN/COMMIT block on a single client, rolling
   * back on any thrown error. Use this for anything multi-step:
   * instantiating an onboarding (template snapshot + task rows +
   * activity log in one go), claiming a scarce entitlement
   * (SELECT ... FOR UPDATE + insert), dual-confirmation writes, etc.
   */
  async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    const hooks: Array<() => void> = [];
    (client as any)[AFTER_COMMIT] = hooks;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      for (const fn of hooks) fn();
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      delete (client as any)[AFTER_COMMIT];
      client.release();
    }
  }
}
