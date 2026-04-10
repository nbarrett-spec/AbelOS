import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { PAYMENT_TERM_MULTIPLIERS } from './constants'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

export function calculateTermPrice(
  basePrice: number,
  term: keyof typeof PAYMENT_TERM_MULTIPLIERS
): number {
  return Math.round(basePrice * PAYMENT_TERM_MULTIPLIERS[term] * 100) / 100
}

export function calculateMargin(price: number, cost: number): number {
  if (price <= 0) return 0
  return (price - cost) / price
}

export function generateQuoteNumber(sequence: number): string {
  const year = new Date().getFullYear()
  return `ABL-${year}-${String(sequence).padStart(4, '0')}`
}

export function generateOrderNumber(sequence: number): string {
  const year = new Date().getFullYear()
  return `ORD-${year}-${String(sequence).padStart(4, '0')}`
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
  })
}
