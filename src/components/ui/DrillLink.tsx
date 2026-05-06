'use client'
import Link from 'next/link'

type Entity = 'job' | 'order' | 'builder' | 'po' | 'invoice' | 'quote' | 'community' | 'product' | 'vendor' | 'delivery'

const ENTITY_HREF: Record<Entity, (id: string) => string> = {
  job: (id) => `/ops/jobs/${id}`,
  order: (id) => `/ops/orders?q=${id}`, // /ops/orders/[id] doesn't exist
  builder: (id) => `/ops/accounts/${id}`,
  po: (id) => `/ops/purchasing/${id}`,
  invoice: (id) => `/ops/invoices/${id}`,
  quote: (id) => `/ops/quotes?q=${id}`,
  community: (id) => `/ops/communities/${id}`,
  product: (id) => `/ops/products?search=${id}`,
  vendor: (id) => `/ops/vendors/${id}`,
  delivery: (id) => `/ops/deliveries/${id}`,
}

export function DrillLink({ entity, id, children, className }: {
  entity: Entity
  id: string | null | undefined
  children: React.ReactNode
  className?: string
}) {
  if (!id) return <>{children}</>
  return (
    <Link
      href={ENTITY_HREF[entity](id)}
      className={`text-signal hover:text-signal-hover hover:underline cursor-pointer ${className ?? ''}`}
    >
      {children}
    </Link>
  )
}
