import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MessagesSectionTabs from './MessagesSectionTabs';

describe('MessagesSectionTabs', () => {
    it('keeps conversations selected by default and switches explicitly to suggestions', () => {
        const onChange = vi.fn();
        const { rerender } = render(<MessagesSectionTabs value="conversations" onChange={onChange} />);

        expect(screen.getByRole('tab', { name: 'Conversaciones' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('tab', { name: 'Sugerencias' }));
        expect(onChange).toHaveBeenCalledWith('suggestions');

        rerender(<MessagesSectionTabs value="suggestions" onChange={onChange} />);
        expect(screen.getByRole('tab', { name: 'Sugerencias' })).toHaveAttribute('aria-selected', 'true');
    });
});
