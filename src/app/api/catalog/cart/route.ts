export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth';

// Simple session-based cart stored as JSON in cookies
// Format: { items: [{ productId, quantity, unitPrice, description, sku }] }

interface CartItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  description: string;
  sku: string;
}

interface CartData {
  items: CartItem[];
}

const CART_COOKIE_NAME = 'abel_quote_cart';

function getCartFromCookie(request: NextRequest): CartData {
  const cartCookie = request.cookies.get(CART_COOKIE_NAME);
  if (cartCookie && cartCookie.value) {
    try {
      return JSON.parse(cartCookie.value);
    } catch {
      return { items: [] };
    }
  }
  return { items: [] };
}

function setCartCookie(response: NextResponse, cart: CartData): void {
  response.cookies.set(CART_COOKIE_NAME, JSON.stringify(cart), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
}

export async function GET(request: NextRequest) {
  const auth = await getSession()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const cart = getCartFromCookie(request);
    const response = NextResponse.json(cart, { status: 200 });
    setCartCookie(response, cart);
    return response;
  } catch (error) {
    console.error('GET /api/catalog/cart error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cart' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await getSession()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json();

    const {
      productId,
      quantity,
      unitPrice,
      description,
      sku,
    } = body;

    if (!productId || !quantity || !unitPrice || !description || !sku) {
      return NextResponse.json(
        {
          error: 'Missing required fields: productId, quantity, unitPrice, description, sku',
        },
        { status: 400 }
      );
    }

    const cart = getCartFromCookie(request);

    // Check if item already in cart, update quantity if so
    const existingItem = cart.items.find((item) => item.productId === productId);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.items.push({
        productId,
        quantity,
        unitPrice,
        description,
        sku,
      });
    }

    const response = NextResponse.json(cart, { status: 201 });
    setCartCookie(response, cart);
    return response;
  } catch (error) {
    console.error('POST /api/catalog/cart error:', error);
    return NextResponse.json(
      { error: 'Failed to add item to cart' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await getSession()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json(
        { error: 'Missing required field: productId' },
        { status: 400 }
      );
    }

    const cart = getCartFromCookie(request);

    // Remove item from cart
    cart.items = cart.items.filter((item) => item.productId !== productId);

    const response = NextResponse.json(cart, { status: 200 });
    setCartCookie(response, cart);
    return response;
  } catch (error) {
    console.error('DELETE /api/catalog/cart error:', error);
    return NextResponse.json(
      { error: 'Failed to remove item from cart' },
      { status: 500 }
    );
  }
}
