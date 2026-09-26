import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

/** Matches ParseUUIDPipe's own accepted shape, used where the value may
 *  legitimately be an empty string instead and so cannot go through a pipe. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // Only SuperAdmin/HR upload company documents.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.documentsService.createDocument(
      actor.id,
      dto.title,
      dto.departmentId ?? null,
      file.filename,
      dto.category ?? null,
      dto.isAvailable !== 'false',
    );
  }

  /**
   * Edit a company document: its title, the branch it is active for, or the
   * PDF itself. Same @Roles as upload — a policy is a company-wide artefact
   * and changing which department it applies to changes who can see it, so
   * this is HR's alone.
   *
   * Multipart like the upload above, because the replacement PDF travels
   * with the scalar fields. `file` is optional here: most edits are a title
   * or a change of scope and should not require re-uploading the document.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Patch(':id')
  @UseInterceptors(FileInterceptor('file'))
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UpdateDocumentDto,
  ) {
    // '' is "company-wide" and undefined is "leave it alone"; anything else
    // has to be a real department id. Checked here rather than with
    // @IsUUID on the DTO, which would reject the empty string outright.
    let departmentId: string | null | undefined;
    if (dto.departmentId !== undefined) {
      const trimmed = dto.departmentId.trim();
      if (trimmed === '') {
        departmentId = null;
      } else if (!UUID_RE.test(trimmed)) {
        throw new BadRequestException(
          "'departmentId' must be a department id, or empty for company-wide",
        );
      } else {
        departmentId = trimmed;
      }
    }

    return this.documentsService.updateDocument(actor.id, id, {
      title: dto.title,
      departmentId,
      storedFilename: file?.filename,
      category: dto.category,
      isAvailable: dto.isAvailable === undefined ? undefined : dto.isAvailable === 'true',
    });
  }

  /**
   * Permanently take a policy down. Soft delete — the row is flagged, not
   * destroyed — but from the app's side it is gone: every list and download
   * filters it out. HR-only, same as upload and edit.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Delete(':id')
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.documentsService.softDeleteDocument(actor.id, id);
    return { ok: true };
  }

  // Any authenticated user — scoped server-side to company-wide docs
  // plus their own department, see DocumentsService.
  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.documentsService.listVisibleForActor(actor.id);
  }

  // Streams the file through the app rather than a static file route,
  // so the same department-scoping applies to downloads as to listing
  // — a direct /uploads/<filename> URL is never exposed to clients.
  @UseGuards(JwtAuthGuard)
  @Get(':id/download')
  async download(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { title, storedFilename } = await this.documentsService.getDownloadableOrThrow(
      id,
      actor.id,
    );
    const absolutePath = resolve(this.documentsService.getUploadsDir(), storedFilename);

    res.download(absolutePath, title, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ statusCode: 404, message: 'File not found on disk' });
      }
    });
  }
}
