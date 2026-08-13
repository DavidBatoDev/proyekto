import { PersonalWorkspaceService } from './personal-workspace.service';

function buildService(options?: {
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  mappingData?: unknown;
}) {
  const query: any = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    maybeSingle: jest.fn().mockResolvedValue({
      data: options?.mappingData ?? null,
      error: null,
    }),
  };
  const supabase = {
    rpc: jest.fn().mockResolvedValue({
      data: options?.rpcData ?? null,
      error: options?.rpcError ?? null,
    }),
    from: jest.fn((table: string) => {
      if (table !== 'personal_workspaces') {
        throw new Error(`Unexpected table access: ${table}`);
      }
      return query;
    }),
  };
  const chatService = {
    provisionDefaultChannels: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new PersonalWorkspaceService(
      supabase as never,
      chatService as never,
    ),
    supabase,
    query,
    chatService,
  };
}

describe('PersonalWorkspaceService', () => {
  it('provisions through the race-safe database RPC', async () => {
    const workspace = {
      id: 'ws-1',
      title: "Alex's Workspace",
      owner_id: 'user-1',
      status: 'active',
    };
    const { service, supabase, chatService } = buildService({
      rpcData: [workspace],
    });

    await expect(service.provision('user-1')).resolves.toEqual(workspace);
    expect(supabase.rpc).toHaveBeenCalledWith('provision_personal_workspace', {
      p_user_id: 'user-1',
    });
    expect(chatService.provisionDefaultChannels).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      'personal',
    );
  });

  it('surfaces RPC failures', async () => {
    const { service } = buildService({
      rpcError: { message: 'provision failed' },
    });

    await expect(service.provision('user-1')).rejects.toThrow(
      'provision failed',
    );
  });

  it('looks up the workspace through the normalized mapping', async () => {
    const workspace = {
      id: 'ws-2',
      title: "Sam's Workspace",
      owner_id: 'user-2',
      status: 'active',
    };
    const { service, supabase, query } = buildService({
      mappingData: { project: workspace },
    });

    await expect(service.findForUser('user-2')).resolves.toEqual(workspace);
    expect(supabase.from).toHaveBeenCalledWith('personal_workspaces');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-2');
  });

  it('returns null when the user has no workspace mapping', async () => {
    const { service } = buildService();
    await expect(service.findForUser('user-x')).resolves.toBeNull();
  });
});
