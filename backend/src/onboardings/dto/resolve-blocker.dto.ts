import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Resolving takes an optional note — "device arrived", "candidate sent the
 * corrected scan" — which is why it was cleared rather than that it was.
 *
 * It is NOT a column on blockers. A resolution note is audit information:
 * written once, never edited, only ever read back as history. That is
 * exactly what activity_logs is, and that table is append-only at the
 * database-role level, so the note lands somewhere it cannot be quietly
 * rewritten. A nullable text column on blockers would have been a second
 * home for the same fact with weaker guarantees.
 */
export class ResolveBlockerDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
