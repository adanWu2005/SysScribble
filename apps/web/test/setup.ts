// Deterministic environment for route-handler tests. No real service is contacted.
process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost:54321';
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon-test-key';
process.env['NEXT_PUBLIC_WS_URL'] = 'ws://localhost:4001';
process.env['NEXT_PUBLIC_LIVEKIT_URL'] = 'wss://test.livekit.cloud';
process.env['NEXT_PUBLIC_APP_URL'] = 'http://localhost:3000';
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-test-key';
process.env['SUPABASE_JWT_SECRET'] = 'super-secret-test-jwt-secret-at-least-32-bytes-long';
process.env['UPSTASH_REDIS_REST_URL'] = 'https://test.upstash.io';
process.env['UPSTASH_REDIS_REST_TOKEN'] = 'upstash-test-token';
process.env['R2_ACCOUNT_ID'] = 'r2account';
process.env['R2_ACCESS_KEY_ID'] = 'r2key';
process.env['R2_SECRET_ACCESS_KEY'] = 'r2secret';
process.env['R2_BUCKET'] = 'test-bucket';
process.env['LIVEKIT_API_KEY'] = 'lkkey';
process.env['LIVEKIT_API_SECRET'] = 'lksecret-lksecret-lksecret-lksecret';
process.env['RESEND_API_KEY'] = 're_test';
process.env['RESEND_FROM'] = 'Test <test@example.com>';
