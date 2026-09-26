import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UploadDocumentDto {
  @IsString()
  @MinLength(1)
  title!: string;

  // NULL = company-wide, matching documents.department_id's own
  // schema comment. Omit the field entirely for a company-wide doc.
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  // The policy's type. Constrained to the same three the frontend tabs use;
  // omitted leaves it NULL and the frontend guesses from the title, exactly
  // as it did before this field existed.
  @IsOptional()
  @IsIn(['health', 'travel', 'general'])
  category?: 'health' | 'travel' | 'general';

  // 'true' / 'false' as a string, because the request is multipart. Omitted
  // defaults to available, which is what a newly uploaded policy should be.
  @IsOptional()
  @IsIn(['true', 'false'])
  isAvailable?: 'true' | 'false';
}
