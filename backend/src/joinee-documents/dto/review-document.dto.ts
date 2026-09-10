import { IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';

export class ReviewDocumentDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  /**
   * Required for a rejection so the joinee is told what to fix — the
   * chk_rejection_has_note constraint enforces the same thing at the
   * database level, this just turns it into a 400 instead of a 500.
   */
  @ValidateIf((dto: ReviewDocumentDto) => dto.decision === 'rejected')
  @IsString()
  @MaxLength(1000)
  note?: string;
}
