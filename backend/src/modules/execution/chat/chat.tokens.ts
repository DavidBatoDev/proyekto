/**
 * Chat DI tokens and shared sentinels.
 *
 * Separate from chat.service.ts so ChatPushService can inject the repository
 * without importing the service that injects ChatPushService — otherwise the two
 * modules form an import cycle.
 */

export const CHAT_REPOSITORY = Symbol('CHAT_REPOSITORY');

/** Sentinel user id standing in for `@everyone` in a mention list. */
export const EVERYONE_MENTION_ID = 'everyone';
