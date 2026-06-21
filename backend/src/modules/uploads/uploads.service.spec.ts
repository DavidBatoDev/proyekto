import { BadRequestException } from '@nestjs/common';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UploadsService } from './uploads.controller';
import type { R2Config } from '../../config/r2.module';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/put'),
}));

const r2Config: R2Config = {
  publicBucket: 'proyekto-media',
  privateBucket: 'proyekto-private',
  publicBaseUrl: 'https://cdn.proyekto.tech',
};

function makeService(supabase: unknown = {}) {
  const r2 = { send: jest.fn().mockResolvedValue({}) } as any;
  const service = new UploadsService(supabase as any, r2, r2Config);
  return { service, r2 };
}

const baseDto = {
  fileName: 'photo.png',
  fileType: 'image/png',
  fileSize: 1024,
} as const;

describe('UploadsService.createSignedUrl', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a custom-domain public URL for a public bucket', async () => {
    const { service } = makeService();
    const res = await service.createSignedUrl('user-1', {
      ...baseDto,
      bucket: 'avatars',
    } as any);

    expect(res.signedUrl).toBe('https://signed.example/put');
    expect(res.path).toMatch(/^avatars\/user-1\/\d+\.png$/);
    expect(res.publicUrl).toBe(`https://cdn.proyekto.tech/${res.path}`);
    expect((res as Record<string, unknown>).token).toBeUndefined();
  });

  it('returns the bare key (no public URL) for the private identity bucket', async () => {
    const { service } = makeService();
    const res = await service.createSignedUrl('user-1', {
      ...baseDto,
      fileName: 'passport.pdf',
      fileType: 'application/pdf',
      bucket: 'identity_documents',
    } as any);

    expect(res.path).toMatch(/^identity_documents\/user-1\/\d+\.pdf$/);
    // Private bucket: publicUrl is the bare key, not a cdn URL.
    expect(res.publicUrl).toBe(res.path);
    // Presigner targets the private bucket.
    const cmd = (getSignedUrl as jest.Mock).mock.calls[0][1];
    expect(cmd.input.Bucket).toBe('proyekto-private');
  });

  it('rejects an unknown bucket', async () => {
    const { service } = makeService();
    await expect(
      service.createSignedUrl('user-1', { ...baseDto, bucket: 'nope' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects files over the per-bucket size limit', async () => {
    const { service } = makeService();
    await expect(
      service.createSignedUrl('user-1', {
        ...baseDto,
        bucket: 'avatars',
        fileSize: 50 * 1024 * 1024,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects disallowed mime types', async () => {
    const { service } = makeService();
    await expect(
      service.createSignedUrl('user-1', {
        ...baseDto,
        bucket: 'avatars',
        fileType: 'application/x-msdownload',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UploadsService.deleteAvatar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('derives the R2 key from the stored avatar URL and deletes it', async () => {
    const single = jest
      .fn()
      .mockResolvedValueOnce({
        data: {
          avatar_url: 'https://cdn.proyekto.tech/avatars/user-1/123.png',
        },
      })
      .mockResolvedValueOnce({ data: { id: 'user-1' }, error: null });

    const chain: Record<string, unknown> = {};
    chain.select = jest.fn(() => chain);
    chain.eq = jest.fn(() => chain);
    chain.update = jest.fn(() => chain);
    chain.single = single;
    const supabase = { from: jest.fn(() => chain) };

    const { service, r2 } = makeService(supabase);
    await service.deleteAvatar('user-1');

    expect(r2.send).toHaveBeenCalledTimes(1);
    const cmd = r2.send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(DeleteObjectCommand);
    expect(cmd.input).toEqual({
      Bucket: 'proyekto-media',
      Key: 'avatars/user-1/123.png',
    });
  });
});
