"use client";

import React from "react";
import "./SelectionSummary.css";

interface Props {
  totalCost: number;
  completedSelections: number;
  totalSelections: number;
  onConfirm: () => void;
  onReset: () => void;
  confirming: boolean;
  allConfirmed: boolean;
  isLocked: boolean;
  error: string;
}

export default function SelectionSummary({
  totalCost,
  completedSelections,
  totalSelections,
  onConfirm,
  onReset,
  confirming,
  allConfirmed,
  isLocked,
  error,
}: Props) {
  const canConfirm = completedSelections === totalSelections && !isLocked;

  return (
    <div className="summary-bar">
      <div className="summary-content">
        <div className="summary-left">
          <div className="summary-item">
            <span className="summary-label">Total Upgrade Cost</span>
            <span className="summary-value cost">
              ${totalCost.toFixed(0)}
            </span>
          </div>

          <div className="summary-item">
            <span className="summary-label">Selections Made</span>
            <span className="summary-value">
              {completedSelections} of {totalSelections}
            </span>
          </div>
        </div>

        <div className="summary-right">
          {!isLocked && (
            <button
              className="action-button reset-all"
              onClick={onReset}
              disabled={confirming || totalCost === 0}
            >
              Reset All
            </button>
          )}

          <button
            className="action-button confirm"
            onClick={onConfirm}
            disabled={!canConfirm || confirming}
            data-ready={canConfirm}
          >
            {confirming ? "Confirming..." : "Confirm Selections"}
          </button>
        </div>
      </div>

      {error && <div className="summary-error">{error}</div>}

      {isLocked && (
        <div className="summary-locked-notice">
          Your selections have been confirmed. Thank you for choosing Abel
          Lumber!
        </div>
      )}

      {!allConfirmed && !isLocked && (
        <div className="summary-notice">
          Please make all selections before confirming. You currently have{" "}
          <strong>{totalSelections - completedSelections}</strong> selection
          {totalSelections - completedSelections !== 1 ? "s" : ""} remaining.
        </div>
      )}
    </div>
  );
}
