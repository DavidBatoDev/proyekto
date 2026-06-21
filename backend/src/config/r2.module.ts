import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';

export const R2_CLIENT = Symbol('R2_CLIENT');

/**
 * Cloudflare R2 storage configuration. R2 is S3-compatible, so we talk to it
 * through the AWS S3 SDK pointed at the account's R2 endpoint.
 *
 * - R2_PUBLIC_BUCKET serves public assets (avatars, banners, etc.) over the
 *   custom domain in R2_PUBLIC_BASE_URL.
 * - R2_PRIVATE_BUCKET holds private objects (identity documents); no public
 *   access — reads happen via presigned GET URLs.
 */
export interface R2Config {
  publicBucket: string;
  privateBucket: string;
  publicBaseUrl: string;
}

export const R2_CONFIG = Symbol('R2_CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: R2_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): S3Client => {
        const accountId = config.getOrThrow<string>('R2_ACCOUNT_ID');
        return new S3Client({
          region: 'auto',
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
            secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
          },
          forcePathStyle: true,
        });
      },
    },
    {
      provide: R2_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): R2Config => ({
        publicBucket: config.get<string>('R2_PUBLIC_BUCKET', 'proyekto-media'),
        privateBucket: config.get<string>(
          'R2_PRIVATE_BUCKET',
          'proyekto-private',
        ),
        publicBaseUrl: config
          .get<string>('R2_PUBLIC_BASE_URL', 'https://cdn.proyekto.tech')
          .replace(/\/+$/, ''),
      }),
    },
  ],
  exports: [R2_CLIENT, R2_CONFIG],
})
export class R2Module {}
