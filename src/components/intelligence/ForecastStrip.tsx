'use client';

import { FC } from 'react';
import { clsx } from 'clsx';
import { ShoppingCart } from 'lucide-react';
import SkeletonBlock from './SkeletonBlock';

/**
 * Reorder forecast item.
 */
export interface ReorderForecastItem {
  /**
   * Unique identifier (typically productId).
   */
  id: string;
  /**
   * SKU of the product.
   */
  sku: string;
  /**
   * Product name.
   */
  name: string;
  /**
   * Suggested reorder quantity.
   */
  suggestedQty: number;
  /**
   * Confidence level (0-100).
   */
  confidence: number;
  /**
   * Urgency level (e.g., 'OVERDUE', 'DUE_SOON', 'UPCOMING', 'LATER').
   */
  urgency: 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'LATER';
  /**
   * Optional callback when "Add to cart" is clicked.
   */
  onAddToCart?: () => void;
}

/**
 * Props for the ForecastStrip component.
 */
export interface ForecastStripProps {
  /**
   * Array of forecast items.
   */
  items: ReorderForecastItem[];
  /**
   * Is loading? (default: false).
   */
  isLoading?: boolean;
  /**
   * Additional CSS classes.
   */
  className?: string;
}

/**
 * ForecastStrip - A builder-side reorder forecast row with suggested quantities and actions.
 */
const ForecastStrip: FC<ForecastStripProps> = ({
  items,
  isLoading = false,
  className,
}) => {
  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'OVERDUE':
        return {
          badge: 'bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-300',
          label: 'Overdue',
        };
      case 'DUE_SOON':
        return {
          badge: 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300',
          label: 'Due Soon',
        };
      case 'UPCOMING':
        return {
          badge: 'bg-info-100 dark:bg-info-900/30 text-info-700 dark:text-info-300',
          label: 'Upcoming',
        };
      case 'LATER':
      default:
        return {
          badge: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
          label: 'Later',
        };
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-success-600 dark:text-success-400';
    if (confidence >= 60) return 'text-info-600 dark:text-info-400';
    return 'text-warning-600 dark:text-warning-400';
  };

  // Empty state
  if (!isLoading && (!items || items.length === 0)) {
    return (
      <div className={clsx('py-8 text-center', className)}>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No reorder forecasts available
        </p>
      </div>
    );
  }

  return (
    <div className={clsx('space-y-3', className)}>
      {isLoading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800"
          >
            <SkeletonBlock lines={1} height={16} gap={6} />
          </div>
        ))
      ) : (
        items.map((item) => {
          const { badge, label } = getUrgencyColor(item.urgency);

          return (
            <div
              key={item.id}
              className={clsx(
                'rounded-lg border p-4',
                'bg-white dark:bg-slate-800',
                'border-slate-200 dark:border-slate-700',
                'transition-colors duration-fast',
                'hover:border-slate-300 dark:hover:border-slate-600'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: Product info */}
                <div className="flex-grow min-w-0">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex-grow">
                      <h4 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                        {item.name}
                      </h4>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        SKU: {item.sku}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        'inline-block px-2 py-1 rounded-sm text-xs font-medium flex-shrink-0',
                        badge
                      )}
                    >
                      {label}
                    </span>
                  </div>

                  {/* Suggested quantity and confidence */}
                  <div className="flex items-center gap-4 text-sm">
                    <div>
                      <span className="text-slate-600 dark:text-slate-400">
                        Suggested Qty:
                      </span>
                      <span className="ml-2 font-semibold text-slate-900 dark:text-white">
                        {item.suggestedQty}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-600 dark:text-slate-400">
                        Confidence:
                      </span>
                      <span
                        className={clsx(
                          'ml-2 font-semibold',
                          getConfidenceColor(item.confidence)
                        )}
                      >
                        {item.confidence}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Action button */}
                {item.onAddToCart && (
                  <button
                    onClick={item.onAddToCart}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-2 rounded-md',
                      'bg-abel-navy hover:bg-abel-navy-light text-white',
                      'transition-colors duration-fast',
                      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-abel-navy',
                      'text-sm font-medium flex-shrink-0'
                    )}
                    aria-label={`Add ${item.name} to cart`}
                  >
                    <ShoppingCart className="w-4 h-4" />
                    <span className="hidden sm:inline">Add to Cart</span>
                    <span className="sm:hidden">Add</span>
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default ForecastStrip;
