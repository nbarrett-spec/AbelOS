'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Search, AlertCircle, Loader } from 'lucide-react';

interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitPrice: number;
  status: string;
  description?: string;
}

interface ApiResponse {
  products: Product[];
  total: number;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [categories, setCategories] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const itemsPerPage = 50;

  // Fetch products
  const fetchProducts = async (page: number, search: string = '', category: string = '') => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', itemsPerPage.toString());
      if (search) params.append('search', search);
      if (category) params.append('category', category);

      const response = await fetch(`/api/catalog?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch products: ${response.statusText}`);
      }

      const data: ApiResponse = await response.json();
      setProducts(data.products || []);
      setTotalProducts(data.total || 0);

      // Extract unique categories from products
      const uniqueCategories = Array.from(
        new Set(data.products?.map((p) => p.category).filter(Boolean))
      ) as string[];
      setCategories(uniqueCategories.sort());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  // Initial load and when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory]);

  useEffect(() => {
    fetchProducts(currentPage, searchTerm, selectedCategory);
  }, [currentPage, searchTerm, selectedCategory]);

  const totalPages = Math.ceil(totalProducts / itemsPerPage);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCategory(e.target.value);
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return '#27AE60';
      case 'inactive':
        return '#C6A24E';
      case 'discontinued':
        return '#E74C3C';
      default:
        return '#7F8C8D';
    }
  };

  const getStatusBgColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return '#E8F8F5';
      case 'inactive':
        return '#FEF5E7';
      case 'discontinued':
        return '#FADBD8';
      default:
        return '#ECF0F1';
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F5', padding: '2rem' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ color: '#0f2a3e', fontSize: '2rem', fontWeight: '700', margin: '0 0 0.5rem 0' }}>
            Products
          </h1>
          <p style={{ color: '#7F8C8D', fontSize: '0.95rem', margin: 0 }}>
            Manage your product catalog
          </p>
        </div>

        {/* Filters Card */}
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '1.5rem',
            marginBottom: '2rem',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
          }}
        >
          {/* Search Bar */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label
              htmlFor="search"
              style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: '#0f2a3e',
                marginBottom: '0.5rem',
              }}
            >
              Search Products
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search
                size={18}
                style={{
                  position: 'absolute',
                  left: '0.75rem',
                  color: '#BDC3C7',
                  pointerEvents: 'none',
                }}
              />
              <input
                id="search"
                type="text"
                placeholder="Search by name, SKU..."
                value={searchTerm}
                onChange={handleSearch}
                style={{
                  width: '100%',
                  paddingLeft: '2.5rem',
                  paddingRight: '1rem',
                  paddingTop: '0.75rem',
                  paddingBottom: '0.75rem',
                  border: '1px solid #BDC3C7',
                  borderRadius: '8px',
                  fontSize: '0.95rem',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#0f2a3e')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#BDC3C7')}
              />
            </div>
          </div>

          {/* Category Filter */}
          <div>
            <label
              htmlFor="category"
              style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: '#0f2a3e',
                marginBottom: '0.5rem',
              }}
            >
              Filter by Category
            </label>
            <select
              id="category"
              value={selectedCategory}
              onChange={handleCategoryChange}
              style={{
                width: '100%',
                maxWidth: '250px',
                padding: '0.75rem',
                border: '1px solid #BDC3C7',
                borderRadius: '8px',
                fontSize: '0.95rem',
                fontFamily: 'inherit',
                backgroundColor: 'white',
                cursor: 'pointer',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#0f2a3e')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#BDC3C7')}
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div
            style={{
              backgroundColor: '#FADBD8',
              borderLeft: '4px solid #E74C3C',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '2rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '1rem',
            }}
          >
            <AlertCircle size={20} style={{ color: '#E74C3C', flexShrink: 0, marginTop: '0.125rem' }} />
            <div>
              <h3 style={{ color: '#C0392B', fontSize: '0.95rem', fontWeight: '600', margin: '0 0 0.25rem 0' }}>
                Error loading products
              </h3>
              <p style={{ color: '#A93226', fontSize: '0.875rem', margin: 0 }}>
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Products Table Card */}
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
          }}
        >
          {/* Loading State */}
          {loading && (
            <div
              style={{
                padding: '3rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0f2a3e',
              }}
            >
              <Loader size={32} style={{ marginBottom: '1rem', animation: 'spin 1s linear infinite' }} />
              <p style={{ fontSize: '0.95rem', margin: 0 }}>Loading products...</p>
            </div>
          )}

          {/* Empty State */}
          {!loading && products.length === 0 && (
            <div
              style={{
                padding: '3rem',
                textAlign: 'center',
                color: '#7F8C8D',
              }}
            >
              <p style={{ fontSize: '0.95rem', margin: 0 }}>
                No products found. Try adjusting your filters.
              </p>
            </div>
          )}

          {/* Table */}
          {!loading && products.length > 0 && (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.95rem',
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: '#F8F9FA', borderBottom: '2px solid #E8E8E8' }}>
                      <th
                        style={{
                          padding: '1rem',
                          textAlign: 'left',
                          fontWeight: '600',
                          color: '#0f2a3e',
                          fontSize: '0.875rem',
                        }}
                      >
                        SKU
                      </th>
                      <th
                        style={{
                          padding: '1rem',
                          textAlign: 'left',
                          fontWeight: '600',
                          color: '#0f2a3e',
                          fontSize: '0.875rem',
                        }}
                      >
                        Name
                      </th>
                      <th
                        style={{
                          padding: '1rem',
                          textAlign: 'left',
                          fontWeight: '600',
                          color: '#0f2a3e',
                          fontSize: '0.875rem',
                        }}
                      >
                        Category
                      </th>
                      <th
                        style={{
                          padding: '1rem',
                          textAlign: 'right',
                          fontWeight: '600',
                          color: '#0f2a3e',
                          fontSize: '0.875rem',
                        }}
                      >
                        Unit Price
                      </th>
                      <th
                        style={{
                          padding: '1rem',
                          textAlign: 'center',
                          fontWeight: '600',
                          color: '#0f2a3e',
                          fontSize: '0.875rem',
                        }}
                      >
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product, index) => (
                      <tr
                        key={product.id}
                        style={{
                          borderBottom: '1px solid #E8E8E8',
                          backgroundColor: index % 2 === 0 ? '#FFFFFF' : '#F9F9F9',
                          transition: 'background-color 0.2s',
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = index % 2 === 0 ? '#F5F5F5' : '#F0F0F0')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = index % 2 === 0 ? '#FFFFFF' : '#F9F9F9')
                        }
                      >
                        <td
                          style={{
                            padding: '1rem',
                            color: '#2C2C2C',
                            fontWeight: '500',
                            fontFamily: 'monospace',
                            fontSize: '0.875rem',
                          }}
                        >
                          {product.sku}
                        </td>
                        <td style={{ padding: '1rem', color: '#2C2C2C' }}>
                          {product.name}
                        </td>
                        <td style={{ padding: '1rem', color: '#7F8C8D', fontSize: '0.9rem' }}>
                          {product.category || '—'}
                        </td>
                        <td
                          style={{
                            padding: '1rem',
                            textAlign: 'right',
                            color: '#2C2C2C',
                            fontWeight: '500',
                          }}
                        >
                          ${(product.unitPrice ?? 0).toFixed(2)}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.375rem 0.75rem',
                              borderRadius: '20px',
                              fontSize: '0.8rem',
                              fontWeight: '600',
                              backgroundColor: getStatusBgColor(product.status),
                              color: getStatusColor(product.status),
                              textTransform: 'capitalize',
                            }}
                          >
                            {product.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1.5rem',
                  borderTop: '1px solid #E8E8E8',
                  backgroundColor: '#F9F9F9',
                }}
              >
                <div style={{ fontSize: '0.875rem', color: '#7F8C8D' }}>
                  Showing {(currentPage - 1) * itemsPerPage + 1} to{' '}
                  {Math.min(currentPage * itemsPerPage, totalProducts)} of {totalProducts} products
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    onClick={handlePreviousPage}
                    disabled={currentPage === 1}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '36px',
                      height: '36px',
                      borderRadius: '6px',
                      border: '1px solid #BDC3C7',
                      backgroundColor: currentPage === 1 ? '#ECF0F1' : 'white',
                      color: currentPage === 1 ? '#BDC3C7' : '#0f2a3e',
                      cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                      fontSize: '0.875rem',
                      fontWeight: '500',
                    }}
                    onMouseEnter={(e) => {
                      if (currentPage > 1) {
                        e.currentTarget.style.backgroundColor = '#0f2a3e';
                        e.currentTarget.style.color = 'white';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (currentPage > 1) {
                        e.currentTarget.style.backgroundColor = 'white';
                        e.currentTarget.style.color = '#0f2a3e';
                      }
                    }}
                  >
                    <ChevronLeft size={18} />
                  </button>

                  <div style={{ fontSize: '0.875rem', color: '#7F8C8D', minWidth: '60px', textAlign: 'center' }}>
                    Page {currentPage} of {totalPages}
                  </div>

                  <button
                    onClick={handleNextPage}
                    disabled={currentPage === totalPages}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '36px',
                      height: '36px',
                      borderRadius: '6px',
                      border: '1px solid #BDC3C7',
                      backgroundColor: currentPage === totalPages ? '#ECF0F1' : 'white',
                      color: currentPage === totalPages ? '#BDC3C7' : '#0f2a3e',
                      cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                      fontSize: '0.875rem',
                      fontWeight: '500',
                    }}
                    onMouseEnter={(e) => {
                      if (currentPage < totalPages) {
                        e.currentTarget.style.backgroundColor = '#0f2a3e';
                        e.currentTarget.style.color = 'white';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (currentPage < totalPages) {
                        e.currentTarget.style.backgroundColor = 'white';
                        e.currentTarget.style.color = '#0f2a3e';
                      }
                    }}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
