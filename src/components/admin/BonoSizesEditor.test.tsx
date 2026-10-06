import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BonoSizesEditor } from './BonoSizesEditor';

describe('BonoSizesEditor', () => {
    it('adds, validates, reorders, removes and saves sizes', async () => {
        const onSave = vi.fn(async () => undefined);
        render(<BonoSizesEditor savedSizes={[240, 360, 480]} onSave={onSave} />);
        const save = screen.getByRole('button', { name: /Guardar tamaños/ });
        expect(save).toBeDisabled();

        const input = screen.getByPlaceholderText('Horas (ej. 10)');
        fireEvent.change(input, { target: { value: '6' } });
        fireEvent.click(screen.getByRole('button', { name: /Añadir/ }));
        expect(screen.getByRole('alert')).toHaveTextContent('Ese tamaño ya existe.');

        fireEvent.change(input, { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: /Añadir/ }));
        expect(screen.getByRole('alert')).toHaveTextContent('mayor que 0');

        fireEvent.change(input, { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: /Añadir/ }));
        fireEvent.change(input, { target: { value: '10' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.getByText('10h / mes')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Ordenar de menor a mayor/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Eliminar 6h' }));
        fireEvent.click(screen.getByRole('button', { name: 'Subir 12h' }));

        fireEvent.click(save);
        await waitFor(() => expect(onSave).toHaveBeenCalledWith([240, 480, 720, 600]));
    });

    it('never removes the last size', () => {
        render(<BonoSizesEditor savedSizes={[240]} onSave={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Eliminar 4h' })).toBeDisabled();
    });
});
