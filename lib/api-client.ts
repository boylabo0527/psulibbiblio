"use client";
import { browserClient } from "./supabase-browser";

/** fetch() wrapper that attaches the current Supabase access token as a
 *  Bearer header so protected API routes can identify the user. */
export async function apiFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const client = browserClient();
  const { data } = await client.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  return fetch(input, { ...init, headers });
}
