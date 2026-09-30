import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailerService } from '../../../common/mail/mailer.service';
import type { ChatService } from '../../execution/chat/chat.service';
import type { RoadmapAuthorizationService } from '../../execution/roadmaps/services/roadmap-authorization.service';
import type { BlocksService } from './blocks.service';
import type { SafetyRepository } from './repositories/safety.repository.interface';
import { ReportsService } from './reports.service';

const REPORTER = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '33333333-3333-4333-8333-333333333333';
const COMMENT = '44444444-4444-4444-8444-444444444444';

function setup(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const findReportId =
    overrides.findReportId ?? jest.fn().mockResolvedValue(null);
  const insertReport =
    overrides.insertReport ?? jest.fn().mockResolvedValue('report-1');
  const findComment =
    overrides.findComment ??
    jest.fn().mockResolvedValue({
      id: COMMENT,
      authorId: AUTHOR,
      content: '<p>you are <strong>useless</strong></p>',
      taskId: 'task-1',
    });
  const findProfile =
    overrides.findProfile ??
    jest.fn().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        name: id === REPORTER ? 'Rita Reporter' : 'Andy Author',
        email: `${id.slice(0, 4)}@example.com`,
      }),
    );
  const repo = {
    findReportId,
    insertReport,
    findComment,
    findProfile,
  } as unknown as SafetyRepository;

  const block = overrides.block ?? jest.fn().mockResolvedValue(undefined);
  const blocks = { block } as unknown as BlocksService;

  const getMessageForReport =
    overrides.getMessageForReport ??
    jest.fn().mockResolvedValue({
      message: {
        id: MESSAGE,
        sender_id: AUTHOR,
        content: 'buy cheap followers',
        attachments: [],
        deleted_at: null,
      },
      room: {
        id: 'room-1',
        type: 'channel',
        name: 'General',
        slug: 'general',
        project_id: 'project-1',
      },
    });
  const canReachUser =
    overrides.canReachUser ?? jest.fn().mockResolvedValue(true);
  const chat = { getMessageForReport, canReachUser } as unknown as ChatService;

  const assertViewPermission =
    overrides.assertViewPermission ??
    jest.fn().mockResolvedValue({ roadmapId: 'rm-1', projectId: 'project-1' });
  const authz = {
    assertViewPermission,
  } as unknown as RoadmapAuthorizationService;

  const send = overrides.send ?? jest.fn().mockResolvedValue({ sent: true });
  const mailer = { send } as unknown as MailerService;
  const config = new ConfigService({
    MAIL_FROM_SUPPORT: 'support@proyekto.tech',
  });

  const service = new ReportsService(repo, blocks, chat, authz, mailer, config);
  return {
    service,
    findReportId,
    insertReport,
    block,
    send,
    getMessageForReport,
    assertViewPermission,
    canReachUser,
  };
}

describe('ReportsService', () => {
  it('reports a chat message: checks access, snapshots it and emails support', async () => {
    const { service, getMessageForReport, insertReport, send } = setup();

    const result = await service.report(REPORTER, {
      target_type: 'chat_message',
      target_id: MESSAGE,
      reason: 'spam',
      details: '  third time today  ',
    });

    expect(result).toEqual({ id: 'report-1', blocked: false });
    expect(getMessageForReport).toHaveBeenCalledWith(MESSAGE, REPORTER);
    expect(insertReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: REPORTER,
        reportedUserId: AUTHOR,
        targetType: 'chat_message',
        roomId: 'room-1',
        projectId: 'project-1',
        reason: 'spam',
        details: 'third time today',
        contentSnapshot: 'buy cheap followers',
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0] as {
      to: string;
      subject: string;
      text: string;
    };
    expect(mail.to).toBe('support@proyekto.tech');
    expect(mail.subject).toBe('Report: Spam in #General by Andy Author');
    expect(mail.text).toContain('buy cheap followers');
    expect(mail.text).toContain('third time today');
  });

  it('refuses a message the reporter cannot see', async () => {
    const { service, insertReport } = setup({
      getMessageForReport: jest.fn().mockRejectedValue(new NotFoundException()),
    });

    await expect(
      service.report(REPORTER, {
        target_type: 'chat_message',
        target_id: MESSAGE,
        reason: 'spam',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertReport).not.toHaveBeenCalled();
  });

  it('reports a comment as plain text, behind the roadmap view check', async () => {
    const { service, assertViewPermission, insertReport } = setup();

    await service.report(REPORTER, {
      target_type: 'task_comment',
      target_id: COMMENT,
      reason: 'harassment',
    });

    expect(assertViewPermission).toHaveBeenCalledWith(
      { taskId: 'task-1', epicId: null, featureId: null },
      REPORTER,
    );
    expect(insertReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reportedUserId: AUTHOR,
        contentSnapshot: 'you are useless',
        projectId: 'project-1',
      }),
    );
  });

  it('a repeat report returns the same id and does not email again', async () => {
    const { service, insertReport, send } = setup({
      findReportId: jest.fn().mockResolvedValue('report-existing'),
    });

    const result = await service.report(REPORTER, {
      target_type: 'chat_message',
      target_id: MESSAGE,
      reason: 'spam',
    });

    expect(result.id).toBe('report-existing');
    expect(insertReport).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('also_block blocks the author in the same step', async () => {
    const { service, block } = setup();

    const result = await service.report(REPORTER, {
      target_type: 'chat_message',
      target_id: MESSAGE,
      reason: 'harassment',
      also_block: true,
    });

    expect(block).toHaveBeenCalledWith(REPORTER, AUTHOR);
    expect(result.blocked).toBe(true);
  });

  it("won't let someone report their own message", async () => {
    const { service } = setup({
      getMessageForReport: jest.fn().mockResolvedValue({
        message: {
          id: MESSAGE,
          sender_id: REPORTER,
          content: 'x',
          attachments: [],
          deleted_at: null,
        },
        room: { id: 'room-1', type: 'dm', slug: 'a_b', project_id: null },
      }),
    });

    await expect(
      service.report(REPORTER, {
        target_type: 'chat_message',
        target_id: MESSAGE,
        reason: 'other',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a person report 404s when the reporter has no connection to them', async () => {
    const { service, insertReport } = setup({
      canReachUser: jest.fn().mockResolvedValue(false),
    });

    await expect(
      service.report(REPORTER, {
        target_type: 'user',
        target_id: AUTHOR,
        reason: 'harassment',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertReport).not.toHaveBeenCalled();
  });

  it('keeps the report when the email fails', async () => {
    const { service } = setup({
      send: jest.fn().mockRejectedValue(new Error('smtp down')),
    });

    await expect(
      service.report(REPORTER, {
        target_type: 'chat_message',
        target_id: MESSAGE,
        reason: 'spam',
      }),
    ).resolves.toEqual({ id: 'report-1', blocked: false });
  });
});
