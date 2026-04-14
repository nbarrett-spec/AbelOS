'use client';

import { FC, ReactNode, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import InsightCard, { InsightSeverity } from './InsightCard';

/**
 * Insight item for the strip.
 */
export interface InsightItem {
  /**
   * Unique identifier.
   */
  id: string;
  /**
   * Severity level.
   */
  severity: InsightSeverity;
  /**
   * Icon component.
   */
  icon: ReactNode;
  /**
   * Title.
   */
  title: string;
  /**
   * Body text.
   */
  body: string;
  /**
   * Optional action href.
   */
  actionHref?: string;
  /**
   * Optional action label.
   */
  actionLabel?: string;
  /**
   * Optional action callback.
   */
  onAction?: () => void;
}

/**
 * Props for the InsightStrip component.
 */
export interface InsightStripProps {
  /**
   * Array of insights to display.
   */
  insights: InsightItem[];
  /**
   * Is loading? (default: false).
   */
  isLoading?: boolean;
  /**
   * Show scroll buttons (default: true).
   */
  showScrollButtons?: boolean;
  /**
   * Additional CSS classes.
   */
  className?: string;
}

/**
 * InsightStrip - A horizontally scrollable row of InsightCards with snap and scroll shadows.
 */
const InsightStrip: FC<InsightStripProps> = ({
  insights,
  isLoading = false,
  showScrollButtons = true,
  className,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  };

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollAmount = 320; // Scroll by roughly one card width
    const targetScroll = direction === 'left'
      ? container.scrollLeft - scrollAmount
      : container.scrollLeft + scrollAmount;

    container.scrollTo({ left: targetScroll, behavior: 'smooth' });
  };

  // Empty state
  if (!isLoading && (!insights || insights.length === 0)) {
    return (
      <div className={clsx('py-8 text-center', className)}>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No insights available
        </p>
      </div>
    );
  }

  return (
    <div className={clsx('relative w-full', className)}>
      {/* Left scroll shadow overlay */}
      {canScrollLeft && (
        <div className="absolute top-0 left-0 w-8 h-full bg-gradient-to-r from-white dark:from-slate-900 to-transparent pointer-events-none z-10" />
      )}

      {/* Right scroll shadow overlay */}
      {canScrollRight && (
        <div className="absolute top-0 right-0 w-8 h-full bg-gradient-to-l from-white dark:from-slate-900 to-transparent pointer-events-none z-10" />
      )}

      {/* Scroll container */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{ scrollBehavior: 'smooth' }}
      >
        <div className="flex gap-4 pb-2 px-2">
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex-shrink-0 w-80 h-40 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse"
              />
            ))
            : insights.map((insight) => (
              <div
                key={insight.id}
                className="flex-shrink-0 w-80 snap-start"
              >
                <InsightCard
                  severity={insight.severity}
                  icon={insight.icon}
                  title={insight.title}
                  body={insight.body}
                  actionHref={insight.actionHref}
                  actionLabel={insight.actionLabel}
                  onAction={insight.onAction}
                />
              </div>
            ))}
        </div>
      </div>

      {/* Scroll buttons */}
      {showScrollButtons && (
        <>
          {canScrollLeft && (
            <button
              onClick={() => scroll('left')}
              className={clsx(
                'absolute left-0 top-1/2 -translate-y-1/2 z-20',
                'p-2 rounded-full bg-white dark:bg-slate-800',
                'border border-slate-200 dark:border-slate-700',
                'hover:bg-slate-50 dark:hover:bg-slate-700',
                'transition-colors duration-fast',
                'shadow-elevation-2'
              )}
              aria-label="Scroll left"
            >
              <ChevronLeft className="w-5 h-5 text-slate-700 dark:text-slate-300" />
            </button>
          )}

          {canScrollRight && (
            <button
              onClick={() => scroll('right')}
              className={clsx(
                'absolute right-0 top-1/2 -translate-y-1/2 z-20',
                'p-2 rounded-full bg-white dark:bg-slate-800',
                'border border-slate-200 dark:border-slate-700',
                'hover:bg-slate-50 dark:hover:bg-slate-700',
                'transition-colors duration-fast',
                'shadow-elevation-2'
              )}
              aria-label="Scroll right"
            >
              <ChevronRight className="w-5 h-5 text-slate-700 dark:text-slate-300" />
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default InsightStrip;
