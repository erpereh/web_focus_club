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
import type { CustomerSuggestion, CustomerSuggestionStatus } from '@/types';

export interface CustomerSuggestionSubscriptionOptions {
    statusFilter?: CustomerSuggestionStatus;
}

type CustomerSuggestionActionResult = {
    success: boolean;
    suggestionId: string;
};

export function subscribeCustomerSuggestions(
    { statusFilter }: CustomerSuggestionSubscriptionOptions = {},
    callback: (suggestions: CustomerSuggestion[]) => void,
    onError?: (error: Error) => void,
): Unsubscribe {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
    if (statusFilter) constraints.unshift(where('status', '==', statusFilter));

    return onSnapshot(
        query(collection(db, 'customer_suggestions'), ...constraints),
        (snapshot) => callback(
            snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as CustomerSuggestion),
        ),
        onError,
    );
}

export function subscribeNewCustomerSuggestionsCount(
    callback: (count: number) => void,
    onError?: (error: Error) => void,
): Unsubscribe {
    return onSnapshot(
        query(collection(db, 'customer_suggestions'), where('status', '==', 'new')),
        (snapshot) => callback(snapshot.size),
        onError,
    );
}

const markReviewedCallable = httpsCallable<
    { suggestionId: string },
    CustomerSuggestionActionResult
>(functions, 'adminMarkSuggestionReviewed');

const archiveCallable = httpsCallable<
    { suggestionId: string },
    CustomerSuggestionActionResult
>(functions, 'adminArchiveSuggestion');

const restoreCallable = httpsCallable<
    { suggestionId: string },
    CustomerSuggestionActionResult
>(functions, 'adminRestoreSuggestion');

export async function adminMarkSuggestionReviewed(suggestionId: string): Promise<void> {
    await markReviewedCallable({ suggestionId });
}

export async function adminArchiveSuggestion(suggestionId: string): Promise<void> {
    await archiveCallable({ suggestionId });
}

export async function adminRestoreSuggestion(suggestionId: string): Promise<void> {
    await restoreCallable({ suggestionId });
}
