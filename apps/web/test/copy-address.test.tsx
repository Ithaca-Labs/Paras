import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyAddress } from '@/components/copy-address';

afterEach(cleanup);

const addr = '0x13ba000000000000000000000000000000008a4a';

describe('CopyAddress', () => {
  it('shows the short form and copies the full address', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyAddress address={addr} short />);
    expect(screen.getByText('0x13ba…8a4a')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy wallet address' }));
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(addr);
  });

  it('shows the full address by default', () => {
    render(<CopyAddress address={addr} />);
    expect(screen.getByText(addr)).toBeTruthy();
  });
});
