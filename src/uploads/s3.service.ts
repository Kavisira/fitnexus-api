import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

/**
 * Thin wrapper over an S3-compatible PutObject call used to store member
 * progress photos (see MembersService.addMetricEntry) — a base64 data
 * URL comes in from the client (already compressed there, see
 * members.ts), gets decoded here, and is uploaded under a per-member
 * key so photos are at least loosely organized in the bucket.
 *
 * Works against either real AWS S3 or an S3-compatible provider (this
 * project uses Supabase Storage's S3 endpoint) — set AWS_S3_ENDPOINT to
 * switch into path-style mode for the latter.
 *
 * Requires these env vars (see .env.example):
 *   AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 * For Supabase Storage (or any other S3-compatible provider) also set:
 *   AWS_S3_ENDPOINT           e.g. https://<project-ref>.storage.supabase.co/storage/v1/s3
 *   AWS_S3_PUBLIC_BASE_URL    e.g. https://<project-ref>.supabase.co/storage/v1/object/public
 *   (Supabase serves public reads from a different host/path than the
 *   S3 endpoint above — that's why this is separate from AWS_S3_ENDPOINT.)
 *
 * The bucket needs to allow public reads of objects under
 * `member-checkins/*` — for Supabase, mark the bucket "Public" in the
 * Storage settings; for real AWS S3, a bucket policy or a CloudFront
 * distribution with OAC. There's no signed-URL/expiry handling here
 * since these are meant to stay viewable indefinitely on the Members
 * screen, not a one-time download link.
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private client: S3Client | null = null;
  private bucket: string | null = null;
  private publicBaseUrl: string | null = null;
  // Supabase (and most other S3-compatible providers) serve public
  // reads at <publicBaseUrl>/<bucket>/<key>; real AWS S3's virtual-
  // hosted-style default already has the bucket baked into the host,
  // so the key alone is appended there instead.
  private publicUrlIncludesBucket = false;

  constructor(private config: ConfigService) {
    const region = this.config.get<string>('AWS_REGION');
    const bucket = this.config.get<string>('AWS_S3_BUCKET');
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
    const endpoint = this.config.get<string>('AWS_S3_ENDPOINT');
    const publicBaseUrl = this.config.get<string>('AWS_S3_PUBLIC_BASE_URL');

    if (region && bucket && accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });
      this.bucket = bucket;

      if (endpoint) {
        if (!publicBaseUrl) {
          this.logger.warn(
            'AWS_S3_ENDPOINT is set but AWS_S3_PUBLIC_BASE_URL is not — photo URLs will be wrong. For Supabase Storage this should be https://<project-ref>.supabase.co/storage/v1/object/public',
          );
        }
        // Fallback (no explicit public base configured) just reuses the
        // S3 endpoint itself in path style — correct for a generic
        // S3-compatible provider, though for Supabase specifically you
        // should set AWS_S3_PUBLIC_BASE_URL explicitly (see above).
        this.publicBaseUrl = publicBaseUrl ?? endpoint;
        this.publicUrlIncludesBucket = true;
      } else {
        this.publicBaseUrl = publicBaseUrl ?? `https://${bucket}.s3.${region}.amazonaws.com`;
        this.publicUrlIncludesBucket = false;
      }
    } else {
      this.logger.warn(
        'AWS/S3 env vars not fully set (AWS_REGION/AWS_S3_BUCKET/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) — photo uploads will fail until configured.',
      );
    }
  }

  /** Decodes a `data:image/...;base64,...` URL and uploads it under
   * `member-checkins/<memberId>/<uuid>.<ext>`, returning the public URL
   * to store on the MemberMetricEntry row. */
  async uploadDataUrl(memberId: string, dataUrl: string): Promise<string> {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException(
        'Photo storage isn\'t configured yet — set the AWS_S3_*/Supabase Storage environment variables on the server.',
      );
    }

    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) {
      throw new ServiceUnavailableException('Photo data was not a valid image.');
    }
    const [, mimeType, base64] = match;
    const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const buffer = Buffer.from(base64, 'base64');

    const key = `member-checkins/${memberId}/${randomUUID()}.${extension}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return this.publicUrlIncludesBucket ? `${this.publicBaseUrl}/${this.bucket}/${key}` : `${this.publicBaseUrl}/${key}`;
  }
}
