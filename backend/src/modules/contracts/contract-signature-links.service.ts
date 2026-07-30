import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  MailerService,
  type SendMailResult,
} from '../../common/mail/mailer.service';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { UploadsService } from '../uploads/uploads.controller';
import {
  ContractRow,
  ContractsService,
  type ContractWithSchedule,
} from './contracts.service';
import {
  CreateSignatureLinkDto,
  PublicSignContractDto,
} from './dto/contract-signature-links.dto';

interface SignatureLinkRow {
  id: string;
  contract_id: string;
  token: string;
  party: 'client';
  recipient_email: string | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  created_at: string;
}

/** What the consultant sees about a link. Never includes the token twice over. */
export interface SignatureLinkSummary {
  id: string;
  url: string;
  expires_at: string;
  recipient_email: string | null;
  view_count: number;
  last_viewed_at: string | null;
  used_at: string | null;
  /**
   * Present only on the create response, and only when an email was asked for.
   * Mirrors `InvoiceWithLines.email_delivery` so the web layer reports delivery
   * the same way everywhere — and so a failed send can never be toasted as a
   * success, which is what happened before this existed.
   */
  email_delivery?: { sent: boolean; reason?: string; to?: string };
}

/**
 * The whitelist the public page is allowed to see.
 *
 * A projection, never `select('*')`: the row carries `project_id`,
 * `created_by`, internal `notes` and `client_user_id`, none of which an
 * unauthenticated signer has any business reading. Anything added to
 * `contracts` later is excluded by default, which is the point.
 */
export interface PublicContractView {
  id: string;
  contract_number: string | null;
  status: ContractRow['status'];
  provider_kind: ContractRow['provider_kind'];
  provider_name: string | null;
  provider_address: string | null;
  provider_tin: string | null;
  provider_email: string | null;
  client_name: string | null;
  client_contact_name: string | null;
  client_address: string | null;
  client_tin: string | null;
  client_email: string | null;
  currency: string;
  billing_mode: ContractRow['billing_mode'];
  billing_timing: ContractRow['billing_timing'];
  recurring_fee: number | null;
  client_hourly_rate: number | null;
  included_hours: number | null;
  invoice_cadence: ContractRow['invoice_cadence'];
  invoice_offset_days: number;
  due_days: number;
  service_description: string | null;
  payment_method: string | null;
  service_start_date: string | null;
  service_end_date: string | null;
  contract_end_date: string | null;
  term_count: number | null;
  term_unit: ContractRow['term_unit'];
  auto_renew: boolean;
  notice_days: number | null;
  clauses: ContractRow['clauses'];
  services: ContractRow['services'];
  signed_by_consultant_at: string | null;
  signed_by_consultant_name: string | null;
  signed_by_consultant_signature_url: string | null;
  signed_by_consultant_signature_scale: number;
  signed_by_consultant_signature_offset_x: number;
  signed_by_consultant_signature_offset_y: number;
  signed_by_client_at: string | null;
  signed_by_client_name: string | null;
  signed_by_client_signature_url: string | null;
  signed_by_client_signature_scale: number;
  signed_by_client_signature_offset_x: number;
  signed_by_client_signature_offset_y: number;
  periods: ContractWithSchedule['periods'];
  project_title: string | null;
  expires_at: string;
  already_signed: boolean;
}

const DEFAULT_EXPIRY_DAYS = 14;

@Injectable()
export class ContractSignatureLinksService {
  private readonly logger = new Logger(ContractSignatureLinksService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly contracts: ContractsService,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly uploads: UploadsService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  // ─── consultant side ───────────────────────────────────────────────────────

  /** The current live link for a contract, if there is one. */
  async getActiveLink(
    callerId: string,
    contractId: string,
  ): Promise<SignatureLinkSummary | null> {
    const contract = await this.contracts.getContractRowForLink(contractId);
    await this.projectAuth.assertRole(callerId, contract.project_id, 'admin');

    const row = await this.activeLinkRow(contractId);
    return row ? this.toSummary(row) : null;
  }

  /**
   * The one live link for a contract, unauthorized.
   *
   * Split out of `getActiveLink` so callers that have already authorized —
   * `revokeLink` needs the recipient before it revokes — don't re-fetch the
   * contract and re-run the role assert just to read one row.
   */
  private async activeLinkRow(
    contractId: string,
  ): Promise<SignatureLinkRow | null> {
    const { data, error } = await this.supabase
      .from('contract_signature_links')
      .select('*')
      .eq('contract_id', contractId)
      .is('used_at', null)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return (data as SignatureLinkRow | null) ?? null;
  }

  /**
   * Mint a link. Any existing live link is revoked first — the partial unique
   * index enforces one, and more importantly a consultant who re-shares should
   * not leave an older URL still able to sign.
   */
  async createLink(
    callerId: string,
    contractId: string,
    dto: CreateSignatureLinkDto,
  ): Promise<SignatureLinkSummary> {
    const contract = await this.contracts.getContractRowForLink(contractId);
    await this.projectAuth.assertRole(callerId, contract.project_id, 'admin');

    if (contract.status === 'ended' || contract.status === 'cancelled') {
      throw new BadRequestException(
        `A ${contract.status} contract cannot be sent for signature.`,
      );
    }
    if (contract.signed_by_client_at) {
      throw new BadRequestException('The client has already signed this contract.');
    }
    if (!contract.service_start_date || !contract.service_end_date) {
      throw new BadRequestException(
        'Set the service start date and term before sending the contract to sign.',
      );
    }

    await this.revokeActive(contractId);

    const days = dto.expires_in_days ?? DEFAULT_EXPIRY_DAYS;
    const expiresAt = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const recipient =
      dto.recipient_email?.trim() || contract.client_email?.trim() || null;

    const { data, error } = await this.supabase
      .from('contract_signature_links')
      .insert({
        contract_id: contractId,
        party: 'client',
        recipient_email: recipient,
        expires_at: expiresAt,
        created_by: callerId,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to create the signing link.',
      );
    }

    const summary = this.toSummary(data as SignatureLinkRow);
    if (dto.send_email && recipient) {
      const delivery = await this.emailLink(contract, recipient, summary);
      summary.email_delivery = {
        sent: delivery.sent,
        reason: delivery.reason,
        to: delivery.to,
      };
    }
    return summary;
  }

  async revokeLink(callerId: string, contractId: string): Promise<void> {
    const contract = await this.contracts.getContractRowForLink(contractId);
    await this.projectAuth.assertRole(callerId, contract.project_id, 'admin');

    // Capture the recipient before revoking — afterwards the active-link query
    // returns nothing and we would have nobody to notify.
    const active = await this.activeLinkRow(contractId);
    await this.revokeActive(contractId);

    // A silently dead link is worse than one extra email: the client sits on a
    // URL that 410s with no idea why. Only notify if they were actually sent
    // one and have not already signed with it.
    if (active?.recipient_email && !active.used_at) {
      await this.emailRevocation(contract, active.recipient_email);
    }
  }

  // ─── public side ───────────────────────────────────────────────────────────

  /** The contract behind a valid token, projected down to what a signer may see. */
  async getByToken(token: string): Promise<PublicContractView> {
    const { link, contract } = await this.resolveToken(token);

    // Fire-and-forget: a failed view counter must never block the signer.
    void this.supabase
      .from('contract_signature_links')
      .update({
        view_count: link.view_count + 1,
        last_viewed_at: new Date().toISOString(),
      })
      .eq('id', link.id)
      .then(undefined, (err: unknown) =>
        this.logger.warn(
          `Failed to record signature-link view: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    return this.publicContractView(contract, link);
  }

  /** Stamp the client signature on behalf of the token holder. */
  async signByToken(
    token: string,
    dto: PublicSignContractDto,
  ): Promise<PublicContractView> {
    const { link, contract } = await this.resolveToken(token);

    let signatureUrl: string | null = null;
    if (dto.signature_png) {
      signatureUrl = await this.storeSignature(contract.id, dto.signature_png);
    }

    const updated = await this.contracts.signAsTokenBearer(contract, {
      party: 'client',
      signer_name: dto.signer_name,
      signature_url: signatureUrl ?? undefined,
      signature_scale: dto.signature_scale,
      signature_offset_x: dto.signature_offset_x,
      signature_offset_y: dto.signature_offset_y,
    });

    // Burn the link. If this write fails the signature still stands, and the
    // `signed_by_client_at` check in resolveToken blocks a second use anyway.
    const { error } = await this.supabase
      .from('contract_signature_links')
      .update({ used_at: new Date().toISOString() })
      .eq('id', link.id);
    if (error) {
      this.logger.error(
        `Contract ${contract.id} signed but the link was not marked used: ${error.message}`,
      );
    }

    return this.publicContractView(updated, link);
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  /**
   * Every reason a link may no longer be used, each with its own message —
   * "this link expired" and "this was already signed" are very different things
   * to the person holding it.
   */
  private async resolveToken(
    token: string,
  ): Promise<{ link: SignatureLinkRow; contract: ContractRow }> {
    const { data, error } = await this.supabase
      .from('contract_signature_links')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('This signing link is not valid.');

    const link = data as SignatureLinkRow;
    if (link.revoked_at) {
      throw new GoneException('This signing link was revoked.');
    }
    if (link.used_at) {
      throw new GoneException('This signing link has already been used.');
    }
    // Server clock only — never trust the caller's.
    if (new Date(link.expires_at).getTime() <= Date.now()) {
      throw new GoneException('This signing link has expired.');
    }

    const contract = await this.contracts.getContractRowForLink(
      link.contract_id,
    );
    if (contract.status === 'ended' || contract.status === 'cancelled') {
      throw new GoneException(`This contract is ${contract.status}.`);
    }
    if (contract.signed_by_client_at) {
      throw new GoneException('This contract has already been signed.');
    }
    return { link, contract };
  }

  private async revokeActive(contractId: string): Promise<void> {
    const { error } = await this.supabase
      .from('contract_signature_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('contract_id', contractId)
      .is('used_at', null)
      .is('revoked_at', null);
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Decode a base64 PNG and push it through the SAME bucket validation the
   * authenticated upload route uses. No public upload endpoint exists, and
   * none is needed.
   */
  private async storeSignature(
    contractId: string,
    dataUrl: string,
  ): Promise<string> {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl.trim(),
    );
    if (!match) {
      throw new BadRequestException('The signature must be a PNG image.');
    }
    const buffer = Buffer.from(match[1], 'base64');
    // Re-check the DECODED size: the DTO caps the encoded string, but base64
    // expansion means that is not the same bound.
    if (buffer.byteLength > 5 * 1024 * 1024) {
      throw new BadRequestException('The signature image is too large.');
    }
    const result = await this.uploads.uploadFile(contractId, 'contract_signatures', {
      originalname: 'signature.png',
      mimetype: 'image/png',
      size: buffer.byteLength,
      buffer,
    });
    return (result as { publicUrl: string }).publicUrl;
  }

  private toSummary(row: SignatureLinkRow): SignatureLinkSummary {
    return {
      id: row.id,
      url: `${this.appUrl()}/contract/sign/${row.token}`,
      expires_at: row.expires_at,
      recipient_email: row.recipient_email,
      view_count: row.view_count,
      last_viewed_at: row.last_viewed_at,
      used_at: row.used_at,
    };
  }

  /**
   * Base URL for the signing link the client receives.
   *
   * CLIENT_URL is the fallback rather than a hardcoded host because it is the
   * one base URL guaranteed to exist — env.validation.ts declares it with a
   * default and the Cloud Run deploy always ships it. APP_URL and FRONTEND_URL
   * are overrides that may legitimately be unset.
   */
  private appUrl(): string {
    return (
      this.config.get<string>('APP_URL') ??
      this.config.get<string>('FRONTEND_URL') ??
      this.config.get<string>('CLIENT_URL', 'http://localhost:3000')
    ).replace(/\/+$/, '');
  }

  private async publicContractView(
    contract: ContractRow,
    link: SignatureLinkRow,
  ): Promise<PublicContractView> {
    const { data: project } = await this.supabase
      .from('projects')
      .select('title')
      .eq('id', contract.project_id)
      .maybeSingle();

    return {
      id: contract.id,
      contract_number: contract.contract_number,
      status: contract.status,
      provider_kind: contract.provider_kind,
      provider_name: contract.provider_name,
      provider_address: contract.provider_address,
      provider_tin: contract.provider_tin,
      provider_email: contract.provider_email,
      client_name: contract.client_name,
      client_contact_name: contract.client_contact_name,
      client_address: contract.client_address,
      client_tin: contract.client_tin,
      client_email: contract.client_email,
      currency: contract.currency,
      billing_mode: contract.billing_mode,
      billing_timing: contract.billing_timing,
      recurring_fee: contract.recurring_fee,
      client_hourly_rate: contract.client_hourly_rate,
      included_hours: contract.included_hours,
      invoice_cadence: contract.invoice_cadence,
      invoice_offset_days: contract.invoice_offset_days,
      due_days: contract.due_days,
      service_description: contract.service_description,
      payment_method: contract.payment_method,
      service_start_date: contract.service_start_date,
      service_end_date: contract.service_end_date,
      contract_end_date: contract.contract_end_date,
      term_count: contract.term_count,
      term_unit: contract.term_unit,
      auto_renew: contract.auto_renew,
      notice_days: contract.notice_days,
      clauses: contract.clauses,
      services: contract.services,
      signed_by_consultant_at: contract.signed_by_consultant_at,
      signed_by_consultant_name: contract.signed_by_consultant_name,
      signed_by_consultant_signature_url:
        contract.signed_by_consultant_signature_url,
      signed_by_consultant_signature_scale:
        contract.signed_by_consultant_signature_scale,
      signed_by_consultant_signature_offset_x:
        contract.signed_by_consultant_signature_offset_x,
      signed_by_consultant_signature_offset_y:
        contract.signed_by_consultant_signature_offset_y,
      signed_by_client_at: contract.signed_by_client_at,
      signed_by_client_name: contract.signed_by_client_name,
      signed_by_client_signature_url: contract.signed_by_client_signature_url,
      signed_by_client_signature_scale:
        contract.signed_by_client_signature_scale,
      signed_by_client_signature_offset_x:
        contract.signed_by_client_signature_offset_x,
      signed_by_client_signature_offset_y:
        contract.signed_by_client_signature_offset_y,
      periods: await this.contracts.resolvePeriods(contract),
      project_title: (project as { title: string | null } | null)?.title ?? null,
      expires_at: link.expires_at,
      already_signed: Boolean(contract.signed_by_client_at),
    };
  }

  /**
   * Best-effort — a mail failure must not lose the link the caller just made.
   *
   * Returns the delivery result rather than swallowing it: the consultant has
   * to know whether to copy the link and send it themselves. (There is no
   * try/catch here because `MailerService.send` never throws; it reports.)
   */
  private async emailLink(
    contract: ContractRow,
    to: string,
    summary: SignatureLinkSummary,
  ): Promise<SendMailResult> {
    const provider = contract.provider_name?.trim() || 'Your service provider';
    const result = await this.mailer.send({
      to,
      sender: 'billing',
      onBehalfOf: contract.provider_name,
      replyTo: contract.provider_email ?? undefined,
      subject: `${provider} sent you a service agreement to sign`,
      html: `
          <p>Hello${contract.client_contact_name ? ` ${contract.client_contact_name}` : ''},</p>
          <p>${provider} has sent you a service agreement to review and sign.</p>
          <p><a href="${summary.url}">Open and sign the agreement</a></p>
          <p>This link works once and expires on
             ${new Date(summary.expires_at).toDateString()}.</p>
        `,
    });
    if (!result.sent) {
      this.logger.warn(
        `Signing link created but email to ${to} failed: ${result.reason}`,
      );
    }
    return result;
  }

  /**
   * Tell the client a link they were sent no longer works.
   *
   * Only fires on an explicit revoke, never on the implicit revoke inside
   * `createLink` — replacing a link should send one "here is your new link"
   * email, not that plus a "your link is dead" one moments earlier.
   */
  private async emailRevocation(
    contract: ContractRow,
    to: string,
  ): Promise<SendMailResult> {
    const provider = contract.provider_name?.trim() || 'Your service provider';
    const result = await this.mailer.send({
      to,
      sender: 'billing',
      onBehalfOf: contract.provider_name,
      replyTo: contract.provider_email ?? undefined,
      subject: `The signing link from ${provider} has been withdrawn`,
      html: `
          <p>Hello${contract.client_contact_name ? ` ${contract.client_contact_name}` : ''},</p>
          <p>The link ${provider} sent you to sign the service agreement has
             been withdrawn and no longer works.</p>
          <p>If you were expecting to sign, contact ${provider} for a new link.</p>
        `,
    });
    if (!result.sent) {
      this.logger.warn(
        `Link revoked but notification to ${to} failed: ${result.reason}`,
      );
    }
    return result;
  }
}
