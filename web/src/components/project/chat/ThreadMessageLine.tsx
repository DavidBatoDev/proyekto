import type { ThreadUiMessage } from "./thread";

export function ThreadMessageLine({ message }: { message: ThreadUiMessage }) {
  return (
    <div>
      <p className="text-[15px] leading-relaxed text-gray-900 whitespace-pre-wrap break-words">
        {message.content}
      </p>
      {message.optimisticStatus === "sending" && (
        <p className="text-[11px] text-orange-500 mt-0.5">Sending...</p>
      )}
      {message.optimisticStatus === "failed" && (
        <p className="text-[11px] text-red-500 mt-0.5">Failed to send</p>
      )}
    </div>
  );
}
