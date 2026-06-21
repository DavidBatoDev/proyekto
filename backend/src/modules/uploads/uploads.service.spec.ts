import { BadRequestException } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { UploadsService } from './uploads.controller';
import type { R2Config } from '../../config/r2.module';

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

function makeFile(
  over: Partial<{
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }> = {},
) {
  return {
    originalname: 'photo.png',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('test-bytes'),
    ...over,
  };
}

describe('UploadsService.uploadFile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uploads a public file to proyekto-media and returns a cdn URL', async () => {
    const { service, r2 } = makeService();
    const res = await service.uploadFile('user-1', 'avatars', makeFile() as any);

    expect(r2.send).toHaveBeenCalledTimes(1);
    const cmd = r2.send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input.Bucket).toBe('proyekto-media');
    expect(cmd.input.Key).toMatch(/^avatars\/user-1\/\d+\.png$/);
    expect(cmd.input.ContentType).toBe('image/png');
    expect(res.path).toBe(cmd.input.Key);
    expect(res.publicUrl).toBe(`https://cdn.proyekto.tech/${res.path}`);
  });

  it('uploads identity docs to the private bucket and returns the bare key', async () => {
    const { service, r2 } = makeService();
    const res = await service.uploadFile(
      'user-1',
      'identity_documents',
      makeFile({ originalname: 'passport.pdf', mimetype: 'application/pdf' }) as any,
    );

    const cmd = r2.send.mock.calls[0][0];
    expect(cmd.input.Bucket).toBe('proyekto-private');
    expect(cmd.input.Key).toMatch(/^identity_documents\/user-1\/\d+\.pdf$/);
    // Private bucket: publicUrl is the bare key, not a cdn URL.
    expect(res.publicUrl).toBe(res.path);
  });

  it('rejects when no file is provided', async () => {
    const { service } = makeService();
    await expect(
      service.uploadFile('user-1', 'avatars', undefined as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown bucket', async () => {
    const { service } = makeService();
    await expect(
      service.uploadFile('user-1', 'nope', makeFile() as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects files over the per-bucket size limit', async () => {
    const { service } = makeService();
    await expect(
      service.uploadFile('user-1', 'avatars', makeFile({ size: 50 * 1024 * 1024 }) as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects disallowed mime types', async () => {
    const { service } = makeService();
    await expect(
      service.uploadFile(
        'user-1',
        'avatars',
        makeFile({ mimetype: 'application/x-msdownload' }) as any,
      ),
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
