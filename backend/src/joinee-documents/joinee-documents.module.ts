import { BadRequestException, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { AuthModule } from '../auth/auth.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { OnboardingsModule } from '../onboardings/onboardings.module';
import { JoineeDocumentsController } from './joinee-documents.controller';
import { JoineeDocumentsService } from './joinee-documents.service';

/**
 * Identity documents are rendered inline in HR's browser on the profile
 * screen's Preview click, so unlike DocumentsModule (which caps size and
 * nothing else) this one restricts what can be stored in the first
 * place. An uploaded .html or .svg served inline would execute script in
 * the session of the HR user opening it.
 *
 * Images and PDFs are all the nine document types in the catalogue ever
 * need. SVG is deliberately excluded despite being an image: it can
 * carry script.
 */
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
];

@Module({
  imports: [
    AuthModule,
    ActivityLogModule,
    // For OnboardingTasksService, which owns the completion of the
    // gating task once the last document is submitted.
    OnboardingsModule,
    MulterModule.registerAsync({
      useFactory: (config: ConfigService) => {
        const uploadsDir =
          config.get<string>('JOINEE_UPLOADS_DIR') ?? './uploads/joinee-documents';
        mkdirSync(uploadsDir, { recursive: true });
        return {
          storage: diskStorage({
            // A subdirectory of its own, separate from the company
            // policy PDFs in DocumentsModule — these have a different
            // audience and a different retention story.
            destination: uploadsDir,
            // Server-generated filename, never the client-supplied
            // original, which would be a path-traversal and collision
            // risk. The original is kept in the database column
            // original_filename for display only.
            filename: (_req, file, cb) => {
              cb(null, `${randomUUID()}${extname(file.originalname)}`);
            },
          }),
          fileFilter: (_req, file, cb) => {
            if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
              cb(
                new BadRequestException(
                  `Unsupported file type. Upload a PDF or an image (${ALLOWED_MIME_TYPES.join(', ')}).`,
                ),
                false,
              );
              return;
            }
            cb(null, true);
          },
          limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — a scan or a photo
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [JoineeDocumentsController],
  providers: [JoineeDocumentsService],
  exports: [JoineeDocumentsService],
})
export class JoineeDocumentsModule {}
