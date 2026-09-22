import type { APIRoute } from 'astro';
import { searchEntries } from '../lib/discovery';
export const GET: APIRoute = async ({ site }) => new Response(JSON.stringify(await searchEntries(site)), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
