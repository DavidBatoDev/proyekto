import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { UploadsService } from '../../shared/uploads/uploads.controller';
import { contractTermsSnapshot, TERM_FIELDS } from './contract-diff';
import type { ContractPosition, ContractRow } from './contracts.service';
import {
  type AgreementPdfInput,
  renderAgreementPdf,
} from './pdf/agreement-pdf.renderer';

export type SnapshotKind = 'at_signing' | 'backfill';

/** The terms printed in the agreement's summary table, in reading order. */
const PRINTED_TERMS = new Set([
  'currency',
  'billing_mode',
  'billing_timing',
  'fixed_fee',
  'recurring_fee',
  'client_hourly_rate',
  'included_hours',
  'invoice_cadence',
  'due_days',
  'payment_method',
  'service_description',
  'service_start_date',
  'service_end_date',
  'auto_renew',
  'notice_days',
  'amendment_effective_date',
]);

export function sha256Hex(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * The PDF input for a contract row, exactly as the agreement reads.
 *
 * Signature images are fetched best-effort: a signature whose image cannot be
 * fetched is still frozen with the signer's typed name and date.
 */
export async function agreementPdfInput(
  contract: ContractRow,
  positions: ContractPosition[],
  fetchImage: (url: string) => Promise<Buffer | undefined>,
): Promise<AgreementPdfInput> {
  const seat = (position: 'hirer' | 'provider') =>
    positions.find((entry) => entry.position === position);
  const signedBlock = async (
    position: 'hirer' | 'provider',
    legacy: {
      at: string | null;
      name: string | null;
      url: string | null;
      scale: number;
      x: number;
      y: number;
    },
  ) => {
    const entry = seat(position);
    const at = entry?.signed_at ?? legacy.at;
    const name = entry?.signer_name ?? legacy.name;
    if (!at || !name) return null;
    const url = entry?.signature_url ?? legacy.url;
    return {
      name,
      at,
      image: url ? await fetchImage(url) : undefined,
      imageScale: Number(entry?.signature_scale ?? legacy.scale) || 1,
      imageOffsetX: Number(entry?.signature_offset_x ?? legacy.x) || 0,
      imageOffsetY: Number(entry?.signature_offset_y ?? legacy.y) || 0,
    };
  };

  const snapshot = contractTermsSnapshot(
    contract as unknown as Parameters<typeof contractTermsSnapshot>[0],
  );
  const terms = TERM_FIELDS.filter(({ field }) => PRINTED_TERMS.has(field))
    .map(({ field, label }) => ({ label, value: snapshot.fields[field] }))
    .filter(({ value }) => value !== null && value !== undefined)
    .map(({ label, value }) => ({
      label,
      value:
        typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value),
    }));

  return {
    title: contract.document_title || 'Service Agreement',
    subtitle:
      contract.version > 1 ? `Version ${contract.version} (amendment)` : null,
    providerName: contract.provider_name,
    providerAddress: contract.provider_address,
    providerEmail: contract.provider_email,
    providerTin: contract.provider_tin,
    providerKind: contract.provider_kind,
    clientName: contract.client_name,
    clientContactName: contract.client_contact_name,
    clientAddress: contract.client_address,
    clientEmail: contract.client_email,
    clientTin: contract.client_tin,
    contractNumber: contract.contract_number,
    terms,
    clauses: contract.clauses ?? [],
    // The renderer's "consultant" block is the provider seat and its "client"
    // block the hirer seat, whatever the relationship kind.
    signedByConsultant: await signedBlock('provider', {
      at: contract.signed_by_consultant_at,
      name: contract.signed_by_consultant_name,
      url: contract.signed_by_consultant_signature_url,
      scale: contract.signed_by_consultant_signature_scale,
      x: contract.signed_by_consultant_signature_offset_x,
      y: contract.signed_by_consultant_signature_offset_y,
    }),
    signedByClient: await signedBlock('hirer', {
      at: contract.signed_by_client_at,
      name: contract.signed_by_client_name,
      url: contract.signed_by_client_signature_url,
      scale: contract.signed_by_client_signature_scale,
      x: contract.signed_by_client_signature_offset_x,
      y: contract.signed_by_client_signature_offset_y,
    }),
  };
}

/**
 * Freezes a signed agreement: render once, store privately, record the hash
 * and the signed terms. After this the agreement view serves the stored file,
 * never a re-render, so a later renderer or clause-template change cannot
 * alter what a signed contract shows.
 */
@Injectable()
export class ContractSnapshotService {
  private readonly logger = new Logger(ContractSnapshotService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Freeze once. Never overwrites an existing snapshot: the UPDATE is guarded
   * on signed_pdf_path IS NULL, so a racing second freeze writes nothing.
   * Never throws — a freeze failure must not undo a signature; the history
   * view retries it later as a backfill.
   */
  async freeze(
    contract: ContractRow,
    positions: ContractPosition[],
    kind: SnapshotKind,
  ): Promise<ContractRow | null> {
    if (contract.signed_pdf_path) return contract;
    if (contract.status !== 'signed' && contract.status !== 'ended') {
      return null;
    }
    try {
      const input = await agreementPdfInput(contract, positions, (url) =>
        this.fetchImage(url),
      );
      const body = await renderAgreementPdf(input);
      const sha256 = sha256Hex(body);
      const key = `contract_snapshots/${contract.id}/v${contract.version}-r${contract.revision}-${sha256.slice(0, 12)}.pdf`;
      await this.uploads.putPrivateObject(key, body, 'application/pdf');
      const now = new Date().toISOString();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { data, error } = await this.supabase
        .from('contracts')
        .update({
          signed_pdf_path: key,
          signed_pdf_sha256: sha256,
          signed_terms: contractTermsSnapshot(
            contract as unknown as Parameters<typeof contractTermsSnapshot>[0],
          ),
          signed_snapshot_taken_at: now,
          signed_snapshot_kind: kind,
        })
        .eq('id', contract.id)
        .is('signed_pdf_path', null)
        .select('*')
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as ContractRow | null) ?? contract;
    } catch (error) {
      this.logger.warn(
        `Contract ${contract.id}: snapshot not frozen: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** A private object's bytes (a recorded agreement's evidence). */
  async readObject(key: string): Promise<Buffer> {
    return this.uploads.getPrivateObject(key);
  }

  /** The frozen bytes, re-hashed so the caller can prove they are unchanged. */
  async readFrozen(
    contract: ContractRow,
  ): Promise<{ body: Buffer; sha256: string; verified: boolean } | null> {
    if (!contract.signed_pdf_path || !contract.signed_pdf_sha256) return null;
    const body = await this.uploads.getPrivateObject(contract.signed_pdf_path);
    const sha256 = sha256Hex(body);
    return { body, sha256, verified: sha256 === contract.signed_pdf_sha256 };
  }

  /**
   * Freeze every signed or ended contract that has no snapshot yet, as it
   * stands today. Labelled `backfill` so the UI can say "Snapshot taken on
   * <date>, after signing". Returns how many were frozen.
   */
  async backfill(
    limit = 50,
    loadPositions: (contractId: string) => Promise<ContractPosition[]>,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('*')
      .in('status', ['signed', 'ended'])
      .is('signed_pdf_path', null)
      .order('updated_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    let frozen = 0;
    for (const row of (data ?? []) as ContractRow[]) {
      const result = await this.freeze(
        row,
        await loadPositions(row.id),
        'backfill',
      );
      if (result?.signed_pdf_path) frozen += 1;
    }
    return frozen;
  }

  private async fetchImage(url: string): Promise<Buffer | undefined> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return undefined;
      return Buffer.from(await response.arrayBuffer());
    } catch {
      return undefined;
    }
  }
}
