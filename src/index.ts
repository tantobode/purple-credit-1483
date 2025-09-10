import { Router, IRequest } from 'itty-router';
import { issuer } from '@openauthjs/openauth';
import { CloudflareStorage } from '@openauthjs/openauth/storage/cloudflare';
import { PasswordProvider } from '@openauthjs/openauth/provider/password';
import { PasswordUI } from '@openauthjs/openauth/ui/password';
import { createSubjects } from '@openauthjs/openauth/subject';
import { object, string, parse, optional, number } from 'valibot';

// Define the shape of our user subject for OpenAuth
const subjects = createSubjects({
  user: object({
    id: string(),
    role: string(),
  }),
});

// Helper to create the OpenAuth issuer
const createAuth = (env: Env) => {
  return issuer({
    storage: CloudflareStorage({ namespace: env.AUTH_STORAGE }),
    subjects,
    providers: {
      password: PasswordProvider(
        PasswordUI({
          sendCode: async (email, code) => console.log(`Sending code ${code} to ${email}`),
          copy: { input_code: 'Code (check Worker logs)' },
        }),
      ),
    },
    theme: { title: 'POS System Auth', primary: '#0051c3' },
    success: async (ctx, value) => {
      const user = await getOrCreateUser(env, value.email);
      return ctx.subject('user', { id: user.id, role: user.role });
    },
  });
};

// --- AUTHENTICATION MIDDLEWARE ---
const withAuth = async (request: IRequest, env: Env) => {
    const auth = createAuth(env);
    // This is a guess based on common patterns in auth libraries.
    // The goal is to get the session information from the request's cookies.
    const session = await auth.getSession(request, 'user');

    if (!session?.id) {
        return new Response('Unauthorized. Please log in.', { status: 401 });
    }
    request.user = session; // Attach user to the request for downstream handlers
};

const withAdmin = (request: IRequest) => {
    if (request.user?.role !== 'admin') {
        return new Response('Forbidden: Admin role required.', { status: 403 });
    }
}

// Create a new router
const router = Router();

// --- AUTH DEMO ROUTES ---
router.get('/', (request: IRequest, env: Env, ctx: ExecutionContext) => {
  const url = new URL(request.url);
  url.searchParams.set('redirect_uri', url.origin + '/callback');
  url.searchParams.set('client_id', 'pos-app');
  url.searchParams.set('response_type', 'code');
  url.pathname = '/authorize';
  return Response.redirect(url.toString());
});

router.get('/callback', (request: IRequest) => {
  const url = new URL(request.url);
  return Response.json({ message: 'OAuth flow complete!', params: Object.fromEntries(url.searchParams.entries()) });
});


// --- API ROUTES ---

// A test route to check the current user's session
router.get('/api/me', withAuth, (request: IRequest) => {
    return new Response(JSON.stringify(request.user), { headers: { 'Content-Type': 'application/json' } });
});

// Product Schema for validation
const ProductSchema = object({
    name: string(),
    price: number(),
    stock: number(),
    barcode: optional(string()),
});

// Products API
router.get('/api/products', withAuth, async (request: IRequest, env: Env) => {
    const { results } = await env.AUTH_DB.prepare('SELECT * FROM products').all();
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
});

router.get('/api/products/barcode/:code', withAuth, async (request: IRequest, env: Env) => {
    const { code } = request.params;
    const { results } = await env.AUTH_DB.prepare('SELECT * FROM products WHERE barcode = ?').bind(code).all();
    if (results.length === 0) return new Response('Product not found', { status: 404 });
    return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
});

router.post('/api/products', withAuth, withAdmin, async (request: IRequest, env: Env) => {
    const json = await request.json();
    const product = parse(ProductSchema, json);
    const result = await env.AUTH_DB.prepare('INSERT INTO products (name, price, stock, barcode) VALUES (?, ?, ?, ?) RETURNING id').bind(product.name, product.price, product.stock, product.barcode || null).first();
    return new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } });
});

router.put('/api/products/:id', withAuth, withAdmin, async (request: IRequest, env: Env) => {
    const { id } = request.params;
    const json = await request.json();
    const product = parse(ProductSchema, json);
    await env.AUTH_DB.prepare('UPDATE products SET name = ?, price = ?, stock = ?, barcode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(product.name, product.price, product.stock, product.barcode || null, id).run();
    return new Response(null, { status: 204 });
});

router.delete('/api/products/:id', withAuth, withAdmin, async (request: IRequest, env: Env) => {
    const { id } = request.params;
    await env.AUTH_DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
});


// Transactions API
const TransactionSchema = object({
    type: string(),
    amount: number(),
    description: optional(string()),
});

router.post('/api/transactions', withAuth, async (request: IRequest, env: Env) => {
    const json = await request.json();
    const transaction = parse(TransactionSchema, json);
    const result = await env.AUTH_DB.prepare('INSERT INTO transactions (type, amount, description, user_id) VALUES (?, ?, ?, ?) RETURNING id').bind(transaction.type, transaction.amount, transaction.description || null, request.user.id).first();
    return new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } });
});

router.get('/api/transactions', withAuth, async (request: IRequest, env: Env) => {
    const { results } = await env.AUTH_DB.prepare('SELECT * FROM transactions ORDER BY created_at DESC').all();
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
});

// A catch-all for auth routes, must be last for the router.
router.all('*', (request: IRequest, env: Env, ctx: ExecutionContext) => {
    const auth = createAuth(env);
    return auth.fetch(request, env, ctx);
});

// --- DATABASE HELPERS ---
async function getOrCreateUser(env: Env, email: string): Promise<{ id: string, role: string }> {
  const result = await env.AUTH_DB.prepare('INSERT INTO user (email) VALUES (?) ON CONFLICT (email) DO UPDATE SET email = email RETURNING id, role;').bind(email).first<{ id: string, role: string }>();
  if (!result) throw new Error(`Unable to process user: ${email}`);
  console.log(`Found or created user ${result.id} with email ${email}`);
  return result;
}

// --- Main Handler ---
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return router.handle(request, env, ctx).catch(err => {
        console.error(err);
        const errorMessage = err.issues ? JSON.stringify(err.issues) : err.message;
        return new Response(errorMessage, { status: 400 });
    });
  },
};

// Add user to itty-router's IRequest
declare module 'itty-router' {
    interface IRequest {
        user?: {
            id: string;
            role: string;
        }
    }
}
