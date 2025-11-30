import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  // --- HARDCODED CREDENTIALS (THE NUCLEAR FIX) ---
  const clientId =
    'dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh';
  const clientSecret = '0c5463680eface4bb3958929f73c891d5618266a';
  // This must match your current browser URL exactly
  const redirectUri =
    'https://llqipvnxkrgithub-vxlj--3000--cf284e50.local-credentialless.webcontainer.io/api/auth/callback';
  // -----------------------------------------------

  try {
    // 1. Exchange Code for Tokens
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64'
    );
    const tokenResponse = await fetch(
      'https://api.login.yahoo.com/oauth2/get_token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code: code as string,
        }),
      }
    );

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error('Yahoo Token Error:', tokens);
      return res.status(400).json(tokens);
    }

    // 2. Save to Supabase
    // Note: We still try to read Supabase keys from env. If this fails, we will need to hardcode these too.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'Supabase Environment Variables are missing. Please check .env.local'
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase.from('system_config').upsert({
      key: 'yahoo_auth',
      value: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
      },
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    res
      .status(200)
      .json({
        success: true,
        message: 'Yahoo Connected! You can close this tab.',
      });
  } catch (error: any) {
    console.error('Handler Error:', error);
    res.status(500).json({ error: error.message });
  }
}
