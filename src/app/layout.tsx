import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Warehouse Fulfillment Allocator',
  description: 'Plan an order across the warehouses, reserve the stock, and see why.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
