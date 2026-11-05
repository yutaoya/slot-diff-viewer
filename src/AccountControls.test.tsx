import { render, screen } from '@testing-library/react';
import { AccountControls } from './AccountControls';

it('does not render account controls outside an authenticated account context', () => {
  const { container } = render(<AccountControls />);
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument();
});
