import type { Side } from '../../lib/messages';

/** Mesaje of each side (T11): the list, one conversation, and the way in from a booking card. */
export function messagesPath(side: Side): string {
  return side === 'client' ? '/c/mesaje' : '/s/mesaje';
}

export function threadPath(side: Side, threadId: string): string {
  return `${messagesPath(side)}/${threadId}`;
}

/** Opens the conversation of a booking's client and shop (looked up, then replaced by the thread). */
export function bookingMessagesPath(side: Side, bookingId: string): string {
  return `${messagesPath(side)}/programare/${bookingId}`;
}
