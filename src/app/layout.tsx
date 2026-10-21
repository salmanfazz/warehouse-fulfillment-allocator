import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Warehouse Fulfillment Allocator',
  description: 'Plan an order across the warehouses, reserve the stock, and see why.',
  // An inline icon, so the browser does not ask for /favicon.ico (which does not exist).
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230a6a86'/%3E%3Cpath d='M6 14 16 7l10 7v11H6z' fill='none' stroke='white' stroke-width='2.2' stroke-linejoin='round'/%3E%3Cpath d='M12 25v-7h8v7' fill='none' stroke='white' stroke-width='2.2'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
