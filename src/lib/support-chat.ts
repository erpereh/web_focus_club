import {
    collection,
    onSnapshot,
    orderBy,
    query,
    where,
    type QueryConstraint,
    type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import type {
    SupportConversation,
    SupportConversationStatus,
    SupportMessage,
} from '@/types';

export interface SupportConversationSubscriptionOptions {
    statusFilter?: SupportConversationStatus;
    search?: string;
}

type SupportConversationActionResult = {
    success: boolean;
    conversationId: string;
};

function matchesConversationSearch(conversation: SupportConversation, search: string): boolean {
    const normalizedSearch = search.trim().toLocaleLowerCase('es-ES');
    if (!normalizedSearch) return true;

    return [conversation.userName, conversation.userEmail, conversation.subject]
        .some((value) => value.toLocaleLowerCase('es-ES').includes(normalizedSearch));
}

export function subscribeSupportConversations(
    { statusFilter, search }: SupportConversationSubscriptionOptions = {},
    callback: (conversations: SupportConversation[]) => void,
    onError?: (error: Error) => void,
): Unsubscribe {
    const constraints: QueryConstraint[] = [orderBy('lastMessageAt', 'desc')];
    if (statusFilter) {
        constraints.unshift(where('status', '==', statusFilter));
    }

    return onSnapshot(
        query(collection(db, 'support_conversations'), ...constraints),
        (snapshot) => {
            const conversations = snapshot.docs
                .map((document) => ({ id: document.id, ...document.data() }) as SupportConversation)
                .filter((conversation) => matchesConversationSearch(conversation, search ?? ''));
            callback(conversations);
        },
        onError,
    );
}

export function subscribeSupportMessages(
    conversationId: string,
    callback: (messages: SupportMessage[]) => void,
    onError?: (error: Error) => void,
): Unsubscribe {
    return onSnapshot(
        query(
            collection(db, 'support_conversations', conversationId, 'messages'),
            orderBy('createdAt', 'asc'),
        ),
        (snapshot) => callback(
            snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as SupportMessage),
        ),
        onError,
    );
}

const sendSupportMessageCallable = httpsCallable<
    { conversationId: string; text: string },
    SupportConversationActionResult
>(functions, 'adminSendSupportMessage');

const markConversationReadCallable = httpsCallable<
    { conversationId: string },
    SupportConversationActionResult
>(functions, 'markSupportConversationRead');

const closeConversationCallable = httpsCallable<
    { conversationId: string },
    SupportConversationActionResult
>(functions, 'closeSupportConversation');

const reopenConversationCallable = httpsCallable<
    { conversationId: string },
    SupportConversationActionResult
>(functions, 'reopenSupportConversation');

export async function adminSendSupportMessage(conversationId: string, text: string): Promise<void> {
    await sendSupportMessageCallable({ conversationId, text });
}

export async function markSupportConversationRead(conversationId: string): Promise<void> {
    await markConversationReadCallable({ conversationId });
}

export async function closeSupportConversation(conversationId: string): Promise<void> {
    await closeConversationCallable({ conversationId });
}

export async function reopenSupportConversation(conversationId: string): Promise<void> {
    await reopenConversationCallable({ conversationId });
}
