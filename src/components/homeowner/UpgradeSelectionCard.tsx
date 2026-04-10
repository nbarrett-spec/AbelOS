"use client";

import React, { useEffect, useState } from "react";
import "./UpgradeSelectionCard.css";

interface Product {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  sku: string;
  category?: string;
  subcategory?: string;
}

interface Selection {
  id: string;
  location: string;
  baseProductId: string;
  selectedProductId: string;
  adderCost: number;
  status: string;
  baseProduct?: Product;
  selectedProduct?: Product;
}

interface UpgradePath {
  id: string;
  toProductId: string;
  upgradeType: string;
  description: string;
  priceDelta: number;
  product: Product;
}

interface Props {
  selection: Selection;
  token: string;
  onSelectionChange: (
    selectionId: string,
    productId: string,
    adderCost: number
  ) => void;
  isLocked: boolean;
}

export default function UpgradeSelectionCard({
  selection,
  token,
  onSelectionChange,
  isLocked,
}: Props) {
  const [upgrades, setUpgrades] = useState<UpgradePath[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUpgrade, setSelectedUpgrade] = useState<string | null>(null);

  useEffect(() => {
    const fetchUpgrades = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/homeowner/${token}/upgrades?baseProductId=${selection.baseProductId}`
        );

        if (response.ok) {
          const data: UpgradePath[] = await response.json();
          setUpgrades(data);

          // Set selected upgrade based on current selection
          if (selection.selectedProductId !== selection.baseProductId) {
            const selected = data.find(
              (u) => u.toProductId === selection.selectedProductId
            );
            if (selected) {
              setSelectedUpgrade(selected.id);
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch upgrades:", err);
      }
      setLoading(false);
    };

    fetchUpgrades();
  }, [selection.baseProductId, selection.selectedProductId, token]);

  const handleUpgradeSelect = (upgradeId: string, upgrade: UpgradePath) => {
    setSelectedUpgrade(upgradeId);
    onSelectionChange(
      selection.id,
      upgrade.toProductId,
      upgrade.priceDelta
    );
  };

  const handleResetToBase = () => {
    setSelectedUpgrade(null);
    onSelectionChange(selection.id, selection.baseProductId, 0);
  };

  return (
    <div className="upgrade-card" data-locked={isLocked}>
      <div className="card-header">
        <h3 className="location-name">{selection.location}</h3>
        {isLocked && <span className="locked-badge">Confirmed</span>}
      </div>

      {/* Base Product */}
      <div className="product-section">
        <h4 className="section-title">Included Base Option</h4>
        <div className="base-product-box">
          <div className="product-info">
            <p className="product-name">{selection.baseProduct?.name}</p>
            {selection.baseProduct?.description && (
              <p className="product-description">
                {selection.baseProduct.description}
              </p>
            )}
            <p className="product-price">
              {selection.baseProduct?.basePrice
                ? `$${selection.baseProduct.basePrice.toFixed(0)}`
                : "Included"}
            </p>
          </div>
          <div className="badge included">Included</div>
        </div>
      </div>

      {/* Upgrade Options */}
      {!isLocked && upgrades.length > 0 && (
        <div className="product-section">
          <h4 className="section-title">Upgrade Options</h4>
          <div className="upgrades-list">
            {upgrades.map((upgrade) => (
              <button
                key={upgrade.id}
                className="upgrade-option"
                onClick={() => handleUpgradeSelect(upgrade.id, upgrade)}
                data-selected={selectedUpgrade === upgrade.id}
                disabled={loading}
              >
                <div className="upgrade-header">
                  <p className="upgrade-name">{upgrade.product.name}</p>
                  <p className="upgrade-type">{upgrade.upgradeType}</p>
                </div>

                {upgrade.product.description && (
                  <p className="upgrade-description">
                    {upgrade.product.description}
                  </p>
                )}

                <div className="upgrade-footer">
                  <span className="upgrade-price">
                    +${upgrade.priceDelta.toFixed(0)}
                  </span>
                  {selectedUpgrade === upgrade.id && (
                    <span className="checkmark">✓</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Reset button */}
          {selectedUpgrade && (
            <button
              className="reset-button"
              onClick={handleResetToBase}
              disabled={loading}
            >
              Reset to Included Option
            </button>
          )}
        </div>
      )}

      {/* Current Selection Summary */}
      <div className="selection-summary">
        <p className="summary-label">Current Selection</p>
        <p className="summary-product">
          {selection.selectedProduct?.name || "Loading..."}
        </p>
        {selection.adderCost > 0 && (
          <p className="summary-cost">+${selection.adderCost.toFixed(0)}</p>
        )}
      </div>
    </div>
  );
}
