import type { Preview } from '@storybook/react'
import { withThemeByClassName } from '@storybook/addon-themes'
import React from 'react'
import '../src/app/globals.css'

// Stub global fetch for stories that call internal APIs (SyncChip, Presence, etc.)
if (typeof window !== 'undefined' && !(window as any).__abel_fetch_patched) {
  const realFetch = window.fetch
  ;(window as any).__abel_fetch_patched = true
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0] ?? '')
    if (url.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ ok: true, viewers: [], editors: [], events: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return realFetch(...args)
  }
}

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'Canvas (dark)',
      values: [
        { name: 'Canvas (dark)',  value: '#17150F' },
        { name: 'Canvas (light)', value: '#FAF8F3' },
        { name: 'Surface',        value: '#1F1C15' },
        { name: 'White',          value: '#FFFFFF' },
      ],
    },
    layout: 'centered',
  },
  decorators: [
    withThemeByClassName({
      themes: {
        light: 'theme-light',
        dark: 'theme-dark',
      },
      defaultTheme: 'dark',
    }),
    (Story, ctx) => {
      const density = ctx.globals.density ?? 'default'
      return (
        <div data-density={density} className="p-6 bg-canvas text-fg min-h-[200px]">
          <Story />
        </div>
      )
    },
  ],
  globalTypes: {
    density: {
      description: 'Density mode',
      defaultValue: 'default',
      toolbar: {
        title: 'Density',
        icon: 'component',
        items: [
          { value: 'compact',     title: 'Compact' },
          { value: 'default',     title: 'Default' },
          { value: 'comfortable', title: 'Comfortable' },
        ],
        dynamicTitle: true,
      },
    },
  },
  tags: ['autodocs'],
}

export default preview
