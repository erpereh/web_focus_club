import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    collection: vi.fn(() => 'collection-ref'),
    onSnapshot: vi.fn(() => vi.fn()),
    orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
    query: vi.fn((...parts) => parts),
    where: vi.fn((field, operation, value) => ({ type: 'where', field, operation, value })),
    httpsCallable: vi.fn(() => vi.fn()),
}));

vi.mock('firebase/firestore', () => ({
    collection: mocks.collection,
    onSnapshot: mocks.onSnapshot,
    orderBy: mocks.orderBy,
    query: mocks.query,
    where: mocks.where,
}));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

import { subscribeCustomerSuggestions } from './customer-suggestions';

describe('subscribeCustomerSuggestions', () => {
    beforeEach(() => vi.clearAllMocks());

    it('limits the all filter to active new and reviewed statuses', () => {
        subscribeCustomerSuggestions({}, vi.fn());
        expect(mocks.where).toHaveBeenCalledWith('status', 'in', ['new', 'reviewed']);
        expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    });

    it('uses equality for a specific active status', () => {
        subscribeCustomerSuggestions({ statusFilter: 'reviewed' }, vi.fn());
        expect(mocks.where).toHaveBeenCalledWith('status', '==', 'reviewed');
    });
});
