import type { ReactNode } from 'react';

export const metadata = { title: 'Warehouse Fulfillment Allocator' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
