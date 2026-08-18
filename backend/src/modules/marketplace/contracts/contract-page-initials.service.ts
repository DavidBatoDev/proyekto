import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { UploadsService } from '../../shared/uploads/uploads.controller';
import type { SaveContractInitialsDto } from './dto/contract-page-initials.dto';

/**
 * Per-page initials on a service agreement.
 *
 * The end-of-document signature proves the parties agreed to *a* document.
 * Initials on every page prove they saw each page of THIS one — the control that
 * stops a page being substituted after signing.
 *
 * Both capture methods resolve to a PNG, because the page stamps an image either
 * way; a typed mark additionally stores the characters, since those are the
 * evidence and the rendering is only how they were drawn. Uploading a file is
 * not a method, matching the rule SignaturePad already documents: an uploaded
 * image is the one input that cannot be attributed to the person at the keyboard.
 */

export interface ContractPageInitial {
  contract_id: string;
  position: 'hirer' | 'provider';
  page_index: number;
  method: 'typed' | 'drawn';
  initials_text: string | null;
  image_url: string;
  signed_by: string | null;
  signed_at: string;
}

@Injectable()
export class ContractPageInitialsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly uploads: UploadsService,
  ) {}

  /** Every mark on a contract, ordered so a page renders both seats together. */
  async listForContract(contractId: string): Promise<ContractPageInitial[]> {
    const { data, error } = await this.supabase
      .from('contract_page_initials')
      .select('*')
      .eq('contract_id', contractId)
      .order('page_index')
      .order('position');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as ContractPageInitial[];
  }

  /**
   * Applies one mark across the pages the signer initialled.
   *
   * Adobe Sign's "apply to all pages" is the normal case, so the API takes the
   * page list rather than one page per request — twelve round trips to initial a
   * twelve-page agreement is a worse experience and a worse audit trail, since
   * the marks would carry twelve different timestamps for a single act.
   */
  async save(
    contractId: string,
    signerId: string | null,
    dto: SaveContractInitialsDto,
  ): Promise<ContractPageInitial[]> {
    const contract = await this.getSignableContract(contractId);
    if (contract.status === 'ended' || contract.status === 'cancelled') {
      throw new BadRequestException(
        `A ${contract.status} contract can no longer be initialled.`,
      );
    }

    const pages = [...new Set(dto.pages)].sort((a, b) => a - b);
    if (pages.length === 0) {
      throw new BadRequestException('Choose at least one page to initial.');
    }

    const imageUrl = await this.resolveImage(contractId, dto);
    const signedAt = new Date().toISOString();
    const rows = pages.map((pageIndex) => ({
      contract_id: contractId,
      position: dto.position,
      page_index: pageIndex,
      method: dto.method,
      initials_text:
        dto.method === 'typed' ? (dto.initials_text?.trim() ?? null) : null,
      image_url: imageUrl,
      signed_by: signerId,
      signed_at: signedAt,
    }));

    const { data, error } = await this.supabase
      .from('contract_page_initials')
      .upsert(rows, { onConflict: 'contract_id,position,page_index' })
      .select('*');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as ContractPageInitial[];
  }

  /** Clears a seat's marks — used when a signature is undone. */
  async clearForPosition(
    contractId: string,
    position: 'hirer' | 'provider',
  ): Promise<void> {
    const { error } = await this.supabase
      .from('contract_page_initials')
      .delete()
      .eq('contract_id', contractId)
      .eq('position', position);
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * A signed-in signer uploads the PNG themselves and sends a URL. The public
   * signing page has no session to upload with, so it sends the base64 image and
   * the server stores it — the same split `SignaturePad`'s `deliver` prop makes.
   */
  private async resolveImage(
    contractId: string,
    dto: SaveContractInitialsDto,
  ): Promise<string> {
    if (dto.image_url?.trim()) return dto.image_url.trim();
    if (!dto.image_png?.trim()) {
      throw new BadRequestException('An initials image is required.');
    }
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(
      dto.image_png.trim(),
    );
    if (!match) {
      throw new BadRequestException('The initials image must be a PNG data URL.');
    }
    const buffer = Buffer.from(match[1], 'base64');
    // Re-check the DECODED size: the DTO caps the encoded string, but base64
    // expansion means that is not the same bound. A mark is a few kilobytes;
    // anything larger is not an initials stamp.
    if (buffer.byteLength > 256 * 1024) {
      throw new BadRequestException('The initials image is too large.');
    }
    // Same bucket and validation the signature path uses — there is no public
    // upload endpoint and none is needed.
    const result = await this.uploads.uploadFile(
      contractId,
      'contract_signatures',
      {
        originalname: `initials-${dto.position}.png`,
        mimetype: 'image/png',
        size: buffer.byteLength,
        buffer,
      },
    );
    return (result as { publicUrl: string }).publicUrl;
  }

  private async getSignableContract(
    contractId: string,
  ): Promise<{ id: string; status: string }> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('id, status')
      .eq('id', contractId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Contract not found.');
    return data as { id: string; status: string };
  }
}
