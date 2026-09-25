import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { resolve } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { JoineeDocumentsService } from './joinee-documents.service';
import { ReviewDocumentDto } from './dto/review-document.dto';

@Controller('joinee-documents')
export class JoineeDocumentsController {
  constructor(private readonly joineeDocuments: JoineeDocumentsService) {}

  // The Create New Joinee checkbox grid. HR-only: it's an authoring
  // surface, not something a joinee needs.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('types')
  listTypes() {
    return this.joineeDocuments.listDocumentTypes();
  }

  // HR's review queue. Listed before ':userId'-style routes would be an
  // issue if any existed at this depth; kept literal and distinct.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('pending-review')
  listPendingReview() {
    return this.joineeDocuments.listPendingReview();
  }

  // The employee's own document popup.
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  listMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.joineeDocuments.listForUser(actor.id, actor);
  }

  // The documents section of HR's employee profile screen. No @Roles()
  // here: the service allows either HR or the owning employee, which is
  // data-dependent rather than a fixed role check.
  @UseGuards(JwtAuthGuard)
  @Get('users/:userId')
  listForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.joineeDocuments.listForUser(userId, actor);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post('users/:userId/requirements')
  addRequirement(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: { documentTypeId?: unknown },
  ) {
    if (typeof body?.documentTypeId !== 'string' || !body.documentTypeId) {
      throw new BadRequestException('documentTypeId is required');
    }
    return this.joineeDocuments.addRequirement(userId, body.documentTypeId, actor.id);
  }

  // The joinee uploading one requested document. Ownership is checked in
  // the service against the requirement's own user_id.
  @UseGuards(JwtAuthGuard)
  @Post('requirements/:requirementId/upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.joineeDocuments.recordUpload(requirementId, actor, file);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post('uploads/:uploadId/review')
  review(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.joineeDocuments.review(uploadId, actor, dto);
  }

  /**
   * Streams the file for HR's "Preview" click (and for the joinee
   * reviewing their own upload). Streamed through the app rather than a
   * static route so the same ownership rule applies to the bytes as to
   * the listing — a direct /uploads/<filename> URL is never exposed.
   *
   * Content-Type is the mime_type recorded at upload, and the upload
   * filter restricts that to images and PDFs, so inline rendering is
   * safe. nosniff is set anyway: it stops a browser from second-guessing
   * that header and executing something as HTML, which is the specific
   * risk in rendering user-supplied files inside HR's own session.
   */
  @UseGuards(JwtAuthGuard)
  @Get('uploads/:uploadId/file')
  async streamFile(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { storedFilename, originalFilename, mimeType } =
      await this.joineeDocuments.getFileOrThrow(uploadId, actor);

    const absolutePath = resolve(this.joineeDocuments.getUploadsDir(), storedFilename);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(originalFilename)}"`,
    );
    res.sendFile(absolutePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ statusCode: 404, message: 'File not found on disk' });
      }
    });
  }
}
