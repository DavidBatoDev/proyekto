import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Plus, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/stores/authStore";
import {
  findMemberCandidate,
  findRoomByCounterpart,
  flattenRoomMessages,
  useProjectChatMembersQuery,
  useProjectChatRoomsQuery,
  useRoomMessagesQuery,
  useSendChatMessageMutation,
} from "@/hooks/useChatQueries";
import { chatKeys } from "@/queries/chat";
import type { ChatMemberCandidate, ChatRoom } from "@/services/chat.service";

export const Route = createFileRoute("/project/$projectId/chat")({
  component: ChatPage,
});

type ActiveTarget =
  | { kind: "channel"; slug: "general"; roomId: string | null }
  | { kind: "dm"; userId: string; roomId: string | null };

function getDisplayName(member: ChatMemberCandidate | null): string {
  if (!member) return "Unknown member";
  return member.user?.display_name || member.user?.email || member.user_id;
}

function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | null;
}) {
  const initials = name
    .split(" ")
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="w-7 h-7 rounded-full object-cover object-top shrink-0"
      />
    );
  }

  return (
    <div className="w-7 h-7 rounded-full bg-orange-100 text-orange-600 text-[11px] font-semibold flex items-center justify-center shrink-0">
      {initials || "?"}
    </div>
  );
}

function ChatPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const user = useUser();

  const roomsQuery = useProjectChatRoomsQuery(projectId);
  const membersQuery = useProjectChatMembersQuery(projectId);
  const sendMessageMutation = useSendChatMessageMutation(projectId);

  const rooms = roomsQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const [showPeoplePicker, setShowPeoplePicker] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [activeTarget, setActiveTarget] = useState<ActiveTarget>({
    kind: "channel",
    slug: "general",
    roomId: rooms.find((room) => room.type === "channel" && room.slug === "general")?.id ?? null,
  });

  useEffect(() => {
    const generalRoom = rooms.find(
      (room) => room.type === "channel" && room.slug === "general",
    );

    setActiveTarget((previous) => {
      if (previous.kind === "channel") {
        return { ...previous, roomId: generalRoom?.id ?? null };
      }

      const linkedRoom = findRoomByCounterpart(rooms, previous.userId);
      return { ...previous, roomId: linkedRoom?.id ?? null };
    });
  }, [rooms]);

  const activeRoomId = activeTarget.roomId;
  const messagesQuery = useRoomMessagesQuery(projectId, activeRoomId ?? "");
  const messages = flattenRoomMessages(messagesQuery.data);

  const dmEntries = useMemo(() => {
    return members
      .map((member) => {
        const existingRoom = findRoomByCounterpart(rooms, member.user_id);
        return {
          member,
          room: existingRoom,
        };
      })
      .sort((a, b) => {
        const aHasRoom = !!a.room;
        const bHasRoom = !!b.room;
        if (aHasRoom && !bHasRoom) return -1;
        if (!aHasRoom && bHasRoom) return 1;

        const aTime = a.room?.last_message?.created_at || "";
        const bTime = b.room?.last_message?.created_at || "";
        if (aTime && bTime) {
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        }

        const aName = getDisplayName(a.member).toLowerCase();
        const bName = getDisplayName(b.member).toLowerCase();
        return aName.localeCompare(bName);
      });
  }, [members, rooms]);

  const activeDmMember =
    activeTarget.kind === "dm"
      ? findMemberCandidate(members, activeTarget.userId)
      : null;

  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`chat-room-messages:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_room_messages",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const roomId = String((payload.new as { room_id?: string })?.room_id ?? "");

          void queryClient.invalidateQueries({ queryKey: chatKeys.rooms(projectId) });
          if (roomId) {
            void queryClient.invalidateQueries({
              queryKey: chatKeys.roomMessages(projectId, roomId),
            });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, queryClient]);

  const sendMessage = async () => {
    if (!user || sendMessageMutation.isPending) return;

    const content = messageInput.trim();
    if (!content) return;

    try {
      let result:
        | {
            room: ChatRoom;
            message: unknown;
          }
        | undefined;

      if (activeTarget.kind === "channel") {
        result = await sendMessageMutation.mutateAsync({
          kind: "channel",
          slug: "general",
          content,
        });
      } else if (activeTarget.roomId) {
        result = await sendMessageMutation.mutateAsync({
          room_id: activeTarget.roomId,
          content,
        });
      } else {
        result = await sendMessageMutation.mutateAsync({
          kind: "dm",
          recipient_id: activeTarget.userId,
          content,
        });
      }

      if (result?.room) {
        if (activeTarget.kind === "channel") {
          setActiveTarget({
            kind: "channel",
            slug: "general",
            roomId: result.room.id,
          });
        } else {
          setActiveTarget((prev) =>
            prev.kind === "dm"
              ? { ...prev, roomId: result.room.id }
              : prev,
          );
        }
      }

      setMessageInput("");
    } catch {
      return;
    }
  };

  const isLoading = roomsQuery.isPending || membersQuery.isPending;
  const hasRoomMessages = !!activeRoomId && messages.length > 0;

  return (
    <div className="h-full overflow-hidden">
      <div className="h-full grid grid-cols-1 lg:grid-cols-[300px_1fr]">
        <aside className="border-r border-gray-200 bg-white h-full overflow-y-auto">
          <div className="p-4 border-b border-gray-200">
            <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">
              Project Chat
            </p>
            <h1 className="text-lg font-semibold text-gray-900 mt-1">Conversations</h1>
          </div>

          <div className="p-3">
            <button
              type="button"
              onClick={() => {
                setShowPeoplePicker((value) => !value);
              }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="w-4 h-4" />
              New Message
            </button>
          </div>

          {showPeoplePicker && (
            <div className="px-3 pb-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 max-h-56 overflow-y-auto">
                {members.map((member) => (
                  <button
                    key={member.user_id}
                    type="button"
                    onClick={() => {
                      const existingRoom = findRoomByCounterpart(rooms, member.user_id);
                      setActiveTarget({
                        kind: "dm",
                        userId: member.user_id,
                        roomId: existingRoom?.id ?? null,
                      });
                      setShowPeoplePicker(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-white border-b border-gray-200 last:border-b-0"
                  >
                    <p className="text-sm font-medium text-gray-900">
                      {getDisplayName(member)}
                    </p>
                    <p className="text-xs text-gray-500 uppercase">{member.role}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="px-3 pb-4">
            <p className="px-1 text-xs uppercase tracking-wide text-gray-400 font-semibold">
              Channels
            </p>
            <button
              type="button"
              onClick={() =>
                setActiveTarget({
                  kind: "channel",
                  slug: "general",
                  roomId:
                    rooms.find(
                      (room) => room.type === "channel" && room.slug === "general",
                    )?.id ?? null,
                })
              }
              className={`mt-2 w-full rounded-lg px-3 py-2 text-left ${
                activeTarget.kind === "channel"
                  ? "bg-[#ff9933] text-white"
                  : "hover:bg-gray-100 text-gray-700"
              }`}
            >
              # general
            </button>
          </div>

          <div className="px-3 pb-6">
            <p className="px-1 text-xs uppercase tracking-wide text-gray-400 font-semibold">
              Direct Messages
            </p>
            <div className="mt-2 space-y-1">
              {dmEntries.map((entry) => {
                const isActive =
                  activeTarget.kind === "dm" &&
                  activeTarget.userId === entry.member.user_id;
                const label = getDisplayName(entry.member);
                const preview =
                  entry.room?.last_message?.content || "Start a conversation";
                const avatarUrl =
                  entry.member.user?.avatar_url ??
                  entry.room?.counterpart?.user?.avatar_url ??
                  null;
                return (
                  <button
                    key={entry.member.user_id}
                    type="button"
                    onClick={() =>
                      setActiveTarget({
                        kind: "dm",
                        userId: entry.member.user_id,
                        roomId: entry.room?.id ?? null,
                      })
                    }
                    className={`w-full rounded-lg px-3 py-2 text-left ${
                      isActive
                        ? "bg-[#ff9933] text-white"
                        : "hover:bg-gray-100 text-gray-700"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Avatar name={label} avatarUrl={avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{label}</p>
                        <p
                          className={`text-xs truncate ${
                            isActive ? "text-white/85" : "text-gray-500"
                          }`}
                        >
                          {preview}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
              {dmEntries.length === 0 && (
                <p className="px-1 py-2 text-sm text-gray-500">No direct members available.</p>
              )}
            </div>
          </div>
        </aside>

        <section className="h-full flex flex-col bg-[#f6f7f8]">
          <header className="border-b border-gray-200 bg-white px-5 py-4">
            {activeTarget.kind === "channel" ? (
              <div>
                <p className="text-xs uppercase text-gray-400 font-semibold tracking-wide">
                  Channel
                </p>
                <h2 className="text-lg font-semibold text-gray-900"># general</h2>
              </div>
            ) : (
              <div>
                <p className="text-xs uppercase text-gray-400 font-semibold tracking-wide">
                  Direct Message
                </p>
                <h2 className="text-lg font-semibold text-gray-900">
                  {getDisplayName(activeDmMember)}
                </h2>
              </div>
            )}
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {isLoading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-[#ff9933]" />
              </div>
            ) : hasRoomMessages ? (
              <div className="max-w-3xl space-y-3">
                {messagesQuery.hasNextPage && (
                  <button
                    type="button"
                    onClick={() => void messagesQuery.fetchNextPage()}
                    disabled={messagesQuery.isFetchingNextPage}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {messagesQuery.isFetchingNextPage ? "Loading..." : "Load older messages"}
                  </button>
                )}

                {messages.map((message) => {
                  const isOwnMessage = message.sender_id === user?.id;
                  return (
                    <div
                      key={message.id}
                      className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                          isOwnMessage
                            ? "bg-[#ff9933] text-white"
                            : "bg-white text-gray-800 border border-gray-200"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        <p
                          className={`mt-1 text-[11px] ${
                            isOwnMessage ? "text-white/80" : "text-gray-400"
                          }`}
                        >
                          {new Date(message.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <div className="w-14 h-14 rounded-2xl bg-orange-100 text-orange-500 flex items-center justify-center mb-4">
                  <MessageSquare className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {activeTarget.kind === "channel"
                    ? "Start #general"
                    : `Message ${getDisplayName(activeDmMember)}`}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {activeTarget.kind === "channel"
                    ? "This channel appears in recents after the first message."
                    : "This DM room is created when you send the first message."}
                </p>
              </div>
            )}
          </div>

          <footer className="border-t border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <input
                value={messageInput}
                onChange={(event) => setMessageInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={
                  activeTarget.kind === "channel"
                    ? "Send a message to #general"
                    : `Message ${getDisplayName(activeDmMember)}`
                }
                className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={sendMessageMutation.isPending || messageInput.trim().length === 0}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff9933] text-white hover:bg-[#e68829] disabled:opacity-60"
              >
                {sendMessageMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
