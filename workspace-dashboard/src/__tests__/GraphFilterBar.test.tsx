import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GraphFilterBar from '../components/GraphFilterBar.js';

describe('GraphFilterBar', () => {
  it('renders search input', () => {
    render(<GraphFilterBar value="" onChange={vi.fn()} />);

    const input = screen.getByRole('textbox');
    expect(input).toBeDefined();
  });

  it('displays the correct placeholder text', () => {
    render(<GraphFilterBar value="" onChange={vi.fn()} />);

    const input = screen.getByPlaceholderText('Filter graph nodes...');
    expect(input).toBeDefined();
  });

  it('displays the current value', () => {
    render(<GraphFilterBar value="react" onChange={vi.fn()} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('react');
  });

  it('calls onChange when input value changes', () => {
    const handleChange = vi.fn();
    render(<GraphFilterBar value="" onChange={handleChange} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'hooks' } });

    expect(handleChange).toHaveBeenCalledWith('hooks');
  });

  it('shows clear button when value is non-empty', () => {
    render(<GraphFilterBar value="something" onChange={vi.fn()} />);

    const button = screen.getByRole('button');
    expect(button).toBeDefined();
  });

  it('does not show clear button when value is empty', () => {
    render(<GraphFilterBar value="" onChange={vi.fn()} />);

    const button = screen.queryByRole('button');
    expect(button).toBeNull();
  });

  it('calls onChange with empty string when clear button is clicked', () => {
    const handleChange = vi.fn();
    render(<GraphFilterBar value="filter text" onChange={handleChange} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(handleChange).toHaveBeenCalledWith('');
  });
});
