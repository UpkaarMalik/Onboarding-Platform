import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Editing an existing company document.
 *
 * Everything is optional and everything arrives as a string, because the
 * request is multipart/form-data — the PDF rides along in the same request,
 * so the scalar fields cannot be JSON. `class-transformer` does not coerce
 * multipart values, which is why there is no @IsUUID on departmentId: an
 * empty string is a legitimate value here and would fail that check. The
 * service validates it instead, where the empty-string case is meaningful.
 */
export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  /**
   * Which branch the policy is active for.
   *
   * Three distinct cases, and they have to stay distinct:
   *   omitted           -> leave the scope exactly as it is
   *   '' (empty string) -> company-wide, i.e. department_id = NULL
   *   a UUID            -> that one department
   *
   * A plain `departmentId?: string` cannot express "set this to NULL"
   * without the empty string, which is why undefined and '' mean different
   * things rather than both being treated as "no value".
   */
  @IsOptional()
  @IsString()
  departmentId?: string;

  /** Same three values as upload; omitted leaves the category untouched. */
  @IsOptional()
  @IsIn(['health', 'travel', 'general'])
  category?: 'health' | 'travel' | 'general';

  /**
   * Availability. Multipart form values arrive as strings, so this is the
   * literal 'true' / 'false' rather than a boolean — the controller parses
   * it. Omitted leaves availability untouched.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  isAvailable?: 'true' | 'false';
}
