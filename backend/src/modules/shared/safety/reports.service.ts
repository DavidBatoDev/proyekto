import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '../../../common/mail/mailer.service';
import { resolveSender } from '../../../common/mail/mail-senders';
import { escapeHtml } from '../../../common/mail/templates/escape';
import {
  renderDetailRows,
  renderEmailLayout,
  renderParagraph,
  renderQuoteBlock,
} from '../../../common/mail/templates/layout';
import { renderTextEmail } from '../../../common/mail/templates/text';
import { htmlToText } from '../../../common/utils/html-to-text.util';
import { ChatService } from '../../execution/chat/chat.service';
import { RoadmapAuthorizationService } from '../../execution/roadmaps/services/roadmap-authorization.service';
import { BlocksService } from './blocks.service';
import type { CreateReportDto } from './dto/safety.dto';
import type { SafetyRepository } from './repositories/safety.repository.interface';
import {
  REPORT_REASON_LABEL,
  REPORT_TARGET_LABEL,
  SAFETY_REPOSITORY,
  type CommentTargetType,
} from './safety.tokens';

const SNAPSHOT_MAX_CHARS = 2000;

interface ResolvedTarget {
  reportedUserId: string | null;
  roomId: string | null;
  projectId: string | null;
  snapshot: string | null;
  /** "#general", "a direct message", "a task comment", "their profile". */
  where: string;
}

/** Keeps user-supplied text out of the header it lands in. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Reports of objectionable content (App Store guideline 1.2).
 *
 * A report is accepted only for something the reporter can actually see: the
 * same access check that guards reading it. It is stored with a snapshot of
 * the content (so the evidence survives an unsend or edit) and emailed to the
 * support mailbox, which is the review queue: reports are answered within 24
 * hours by removing the content or suspending the account.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject(SAFETY_REPOSITORY) private readonly repo: SafetyRepository,
    private readonly blocks: BlocksService,
    private readonly chat: ChatService,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  async report(
    reporterId: string,
    dto: CreateReportDto,
  ): Promise<{ id: string; blocked: boolean }> {
    const target = await this.resolveTarget(reporterId, dto);
    if (target.reportedUserId === reporterId) {
      throw new BadRequestException("You can't report yourself.");
    }

    const details = dto.details?.trim() || null;
    let id = await this.repo.findReportId(
      reporterId,
      dto.target_type,
      dto.target_id,
    );
    const isNew = !id;
    if (!id) {
      id =
        (await this.repo.insertReport({
          reporterId,
          reportedUserId: target.reportedUserId,
          targetType: dto.target_type,
          targetId: dto.target_id,
          roomId: target.roomId,
          projectId: target.projectId,
          reason: dto.reason,
          details,
          contentSnapshot: target.snapshot,
        })) ??
        // Lost a race with a double tap: the other request inserted it.
        (await this.repo.findReportId(
          reporterId,
          dto.target_type,
          dto.target_id,
        ));
    }
    if (!id) throw new Error('Report could not be saved.');

    let blocked = false;
    if (dto.also_block && target.reportedUserId) {
      await this.blocks.block(reporterId, target.reportedUserId);
      blocked = true;
    }

    // Only a new report is mailed; a repeat tap must not flood the inbox.
    if (isNew) {
      await this.notifySupport(id, reporterId, dto, target, details, blocked);
    }
    return { id, blocked };
  }

  private async resolveTarget(
    reporterId: string,
    dto: CreateReportDto,
  ): Promise<ResolvedTarget> {
    switch (dto.target_type) {
      case 'chat_message': {
        const { message, room } = await this.chat.getMessageForReport(
          dto.target_id,
          reporterId,
        );
        const attachmentNames = (message.attachments ?? [])
          .map((a) => a.name)
          .filter(Boolean);
        const snapshot = message.deleted_at
          ? null
          : [
              message.content,
              attachmentNames.length
                ? `[attachments: ${attachmentNames.join(', ')}]`
                : '',
            ]
              .filter(Boolean)
              .join('\n')
              .slice(0, SNAPSHOT_MAX_CHARS);
        return {
          reportedUserId: message.sender_id,
          roomId: room.id,
          projectId: room.project_id,
          snapshot,
          where:
            room.type === 'dm'
              ? 'a direct message'
              : `#${room.name || room.slug}`,
        };
      }
      case 'task_comment':
      case 'epic_comment':
      case 'feature_comment':
        return this.resolveComment(reporterId, dto.target_type, dto.target_id);
      case 'user': {
        if (dto.target_id === reporterId) {
          throw new BadRequestException("You can't report yourself.");
        }
        const profile = await this.repo.findProfile(dto.target_id);
        // Same 404 for "doesn't exist" and "you have no connection to them",
        // so the endpoint can't be used to probe for accounts.
        if (
          !profile ||
          !(await this.chat.canReachUser(reporterId, profile.id))
        ) {
          throw new NotFoundException('Person not found.');
        }
        return {
          reportedUserId: profile.id,
          roomId: null,
          projectId: null,
          snapshot: null,
          where: 'their profile',
        };
      }
      default:
        throw new BadRequestException('Unsupported report target.');
    }
  }

  private async resolveComment(
    reporterId: string,
    targetType: CommentTargetType,
    commentId: string,
  ): Promise<ResolvedTarget> {
    const comment = await this.repo.findComment(targetType, commentId);
    if (!comment) throw new NotFoundException('Comment not found.');

    // 404 (not 403) on denial, matching the comment read endpoints.
    const ctx = await this.roadmapAuthz.assertViewPermission(
      {
        taskId: comment.taskId ?? null,
        epicId: comment.epicId ?? null,
        featureId: comment.featureId ?? null,
      },
      reporterId,
    );
    return {
      reportedUserId: comment.authorId,
      roomId: null,
      projectId: ctx.projectId,
      snapshot: htmlToText(comment.content, SNAPSHOT_MAX_CHARS) || null,
      where: `a ${REPORT_TARGET_LABEL[targetType]}`,
    };
  }

  /** Never throws: the report is already saved, which is what matters. */
  private async notifySupport(
    reportId: string,
    reporterId: string,
    dto: CreateReportDto,
    target: ResolvedTarget,
    details: string | null,
    blocked: boolean,
  ): Promise<void> {
    try {
      const to = resolveSender(this.config, 'support').address;
      if (!to) {
        this.logger.error(
          `content_report_not_mailed: no support address configured (report ${reportId})`,
        );
        return;
      }

      const [reporter, reported] = await Promise.all([
        this.repo.findProfile(reporterId),
        target.reportedUserId
          ? this.repo.findProfile(target.reportedUserId)
          : Promise.resolve(null),
      ]);
      const person = (p: typeof reporter, id: string | null) =>
        p
          ? `${p.name}${p.email ? ` <${p.email}>` : ''} (${p.id})`
          : (id ?? '—');

      const reason = REPORT_REASON_LABEL[dto.reason];
      const subject = headerSafe(
        `Report: ${reason} in ${target.where}${reported ? ` by ${reported.name}` : ''}`,
      );
      const rows: { label: string; value: string }[] = [
        { label: 'Reason', value: reason },
        { label: 'What', value: REPORT_TARGET_LABEL[dto.target_type] },
        { label: 'Where', value: target.where },
        {
          label: 'Reported person',
          value: person(reported, target.reportedUserId),
        },
        { label: 'Reported by', value: person(reporter, reporterId) },
        { label: 'Also blocked', value: blocked ? 'Yes' : 'No' },
        { label: 'Report ID', value: reportId },
        { label: 'Target ID', value: dto.target_id },
        ...(target.projectId
          ? [{ label: 'Project ID', value: target.projectId }]
          : []),
        ...(target.roomId ? [{ label: 'Room ID', value: target.roomId }] : []),
      ];

      const bodyHtml = [
        renderParagraph(
          'Someone reported content in Proyekto. Review it within 24 hours: remove the content or suspend the account if it breaks the terms, then set this report’s status in content_reports.',
        ),
        renderDetailRows(
          rows.map((row) => ({
            label: escapeHtml(row.label),
            value: escapeHtml(row.value),
          })),
        ),
        target.snapshot
          ? renderQuoteBlock(target.snapshot)
          : renderParagraph(
              escapeHtml(
                dto.target_type === 'user'
                  ? 'This is a report about the person, not a specific message.'
                  : 'The content had already been deleted when it was reported.',
              ),
            ),
        details
          ? renderParagraph(
              `<strong>Their note:</strong> ${escapeHtml(details)}`,
            )
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const html = renderEmailLayout({
        preheader: `${reason} reported in ${target.where}`,
        title: 'New content report',
        bodyHtml,
        footerNote:
          'Sent to the support mailbox for every new report. App Store guideline 1.2 expects a response within 24 hours.',
      });
      const text = renderTextEmail([
        'Someone reported content in Proyekto. Review it within 24 hours.',
        '',
        ...rows.map((row) => `${row.label}: ${row.value}`),
        '',
        target.snapshot ? `Content:\n${target.snapshot}` : '',
        details ? `Their note:\n${details}` : '',
      ]);

      const result = await this.mailer.send({
        to,
        subject,
        html,
        text,
        sender: 'support',
      });
      if (!result.sent) {
        this.logger.error(
          `content_report_not_mailed: ${result.reason ?? 'unknown reason'} (report ${reportId})`,
        );
      }
    } catch (err) {
      this.logger.error(
        `content_report_not_mailed: ${(err as Error)?.message ?? err} (report ${reportId})`,
      );
    }
  }
}
