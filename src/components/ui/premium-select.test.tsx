import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PremiumSelect, type PremiumSelectOption } from './premium-select';

const OPTIONS: PremiumSelectOption[] = [
  { value: '', label: 'Sin asignar' },
  { value: 'trainer-1', label: 'Sandra' },
  { value: 'trainer-2', label: 'René' },
  { value: 'trainer-disabled', label: 'No disponible', disabled: true },
];

function ControlledSelect({ initialValue = 'trainer-1' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <PremiumSelect
      id="trainer"
      value={value}
      onChange={setValue}
      options={OPTIONS}
      ariaLabel="Entrenador asignado"
    />
  );
}

describe('PremiumSelect', () => {
  it('opens, shows its options, and closes when clicking outside', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Fuera</button>
        <ControlledSelect />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Entrenador asignado' });

    await user.click(trigger);
    expect(screen.getByRole('listbox', { name: 'Entrenador asignado' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sin asignar' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sandra' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fuera' }));
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Entrenador asignado' })).not.toBeInTheDocument();
    });
  });

  it('selects an option, closes, and reflects the controlled selection', () => {
    render(<ControlledSelect />);
    const trigger = screen.getByRole('button', { name: 'Entrenador asignado' });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'René' }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent('René');
    fireEvent.click(trigger);
    expect(screen.getByRole('option', { name: 'René' })).toHaveAttribute('aria-selected', 'true');
  });

  it('closes with Escape and restores focus to the trigger', async () => {
    render(<ControlledSelect />);
    const trigger = screen.getByRole('button', { name: 'Entrenador asignado' });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it('opens and selects with the keyboard while skipping disabled options', () => {
    const onChange = vi.fn();
    render(
      <PremiumSelect
        value="trainer-1"
        onChange={onChange}
        options={OPTIONS}
        ariaLabel="Entrenador asignado"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Entrenador asignado' });

    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'End' });
    fireEvent.keyDown(listbox, { key: ' ' });

    expect(onChange).toHaveBeenCalledWith('trainer-2');
  });

  it('exposes a disabled option and never selects it', () => {
    const onChange = vi.fn();
    render(
      <PremiumSelect
        value="trainer-1"
        onChange={onChange}
        options={OPTIONS}
        ariaLabel="Entrenador asignado"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Entrenador asignado' }));
    const option = screen.getByRole('option', { name: 'No disponible' });
    expect(option).toBeDisabled();
    expect(option).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(option);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports a compact custom-styled disabled trigger', () => {
    render(
      <PremiumSelect
        value="trainer-1"
        onChange={vi.fn()}
        options={OPTIONS}
        ariaLabel="Entrenador asignado"
        disabled
        size="compact"
        className="w-48 uppercase"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Entrenador asignado' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveClass('min-h-9', 'w-48', 'uppercase');
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
